package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
)

// Two-player matchmaking. A player joins the queue with their format, card
// power tier and entry; the first waiting player with the same three values is
// their opponent (PRD: compare format and power tier before anything else, and
// never pair different stakes). Pairing creates a two-player battle and hands
// each side its own token. Searches expire after queueTTL.

const queueTTL = 2 * time.Minute

type queueRequest struct {
	Trainer livebattle.Trainer `json:"trainer"`
	Rating  int                `json:"rating"`
	Format  string             `json:"format"` // "champion" | "squad"
	Tier    int                `json:"tier"`
	Entry   float64            `json:"entry"`
	// Team is the player's card picks. The server relays it to the opponent's
	// loading screen as-is; the authoritative creatures arrive later via SetTeam.
	Team json.RawMessage `json:"team"`
}

// key groups players who may be paired: same format, power tier and entry.
func (q queueRequest) key() string {
	return fmt.Sprintf("%s|%d|%.2f", q.Format, q.Tier, q.Entry)
}

type queueEntry struct {
	ticket  string
	req     queueRequest
	created time.Time
	match   *queueMatch // set once paired, until the waiting player polls it
}

type queueMatch struct {
	ID       string       `json:"id"`
	Token    string       `json:"token"`
	Side     string       `json:"side"`
	Opponent queueRequest `json:"opponent"`
}

func matched(m queueMatch) map[string]any {
	return map[string]any{"status": "matched", "id": m.ID, "token": m.Token, "side": m.Side, "opponent": m.Opponent}
}

// enqueue pairs the caller with a compatible waiting player, or adds them to
// the queue and returns a ticket to poll.
func (s *Server) enqueue(w http.ResponseWriter, r *http.Request) {
	var req queueRequest
	if !decodeBattle(w, r, &req) {
		return
	}
	if !validName(req.Trainer.Name) || (req.Format != "champion" && req.Format != "squad") || len(req.Team) < 3 {
		writeError(w, http.StatusBadRequest, "a name, a format (champion or squad) and a team are required")
		return
	}
	tokens, err := randomTokens(2)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not join the queue")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneQueue(time.Now())
	if waiter := s.takeWaiter(req.key()); waiter != nil {
		id, err := s.newBattleID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not create battle")
			return
		}
		b, err := livebattle.New(id, livebattle.Config{Mode: livebattle.ModePvP, You: waiter.req.Trainer, Opponent: req.Trainer})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		b.SetToken("p1", tokens[0])
		b.SetToken("p2", tokens[1])
		s.battles[id] = b
		waiter.match = &queueMatch{ID: id, Token: tokens[0], Side: "p1", Opponent: req}
		waiter.created = time.Now() // give the waiting player a full TTL to collect the match
		writeJSON(w, http.StatusOK, matched(queueMatch{ID: id, Token: tokens[1], Side: "p2", Opponent: waiter.req}))
		return
	}
	entry := &queueEntry{ticket: tokens[0], req: req, created: time.Now()}
	s.queue[entry.ticket] = entry
	s.waiting = append(s.waiting, entry)
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "searching", "ticket": entry.ticket})
}

// pollQueue reports whether a waiting search has been paired.
func (s *Server) pollQueue(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneQueue(time.Now())
	entry := s.queue[r.PathValue("ticket")]
	switch {
	case entry == nil:
		writeError(w, http.StatusNotFound, "search not found or expired")
	case entry.match != nil:
		delete(s.queue, entry.ticket)
		writeJSON(w, http.StatusOK, matched(*entry.match))
	default:
		writeJSON(w, http.StatusOK, map[string]any{"status": "searching", "ticket": entry.ticket})
	}
}

// cancelQueue withdraws a search that has not been paired yet.
func (s *Server) cancelQueue(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.queue[r.PathValue("ticket")]; entry != nil && entry.match == nil {
		s.removeWaiter(entry)
		delete(s.queue, entry.ticket)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// takeWaiter removes and returns the longest-waiting compatible player. It must
// be called while s.mu is held.
func (s *Server) takeWaiter(key string) *queueEntry {
	for _, entry := range s.waiting {
		if entry.req.key() == key {
			s.removeWaiter(entry)
			return entry
		}
	}
	return nil
}

func (s *Server) removeWaiter(target *queueEntry) {
	for i, entry := range s.waiting {
		if entry == target {
			s.waiting = append(s.waiting[:i], s.waiting[i+1:]...)
			return
		}
	}
}

// pruneQueue drops searches older than queueTTL, paired or not. It must be
// called while s.mu is held.
func (s *Server) pruneQueue(now time.Time) {
	for ticket, entry := range s.queue {
		if now.Sub(entry.created) > queueTTL {
			s.removeWaiter(entry)
			delete(s.queue, ticket)
		}
	}
}

func randomTokens(n int) ([]string, error) {
	out := make([]string, n)
	for i := range out {
		t, err := randomToken()
		if err != nil {
			return nil, err
		}
		out[i] = t
	}
	return out, nil
}
