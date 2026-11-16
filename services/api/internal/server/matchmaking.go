package server

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
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
	Wins    int                `json:"wins"`
	Losses  int                `json:"losses"`
	Format  string             `json:"format"` // "champion" | "squad"
	Tier    int                `json:"tier"`
	Entry   float64            `json:"entry"`
	// Team is validated and locked before pairing; New builds canonical combat data.
	Team []queuePick `json:"team"`
}

// key groups players who may be paired: same format, power tier and entry.
func (q queueRequest) key() string {
	return fmt.Sprintf("%s|%d|%.2f", q.Format, q.Tier, q.Entry)
}

type queueEntry struct {
	ticket  string
	req     queueRequest
	seat    seatTerms // verified NFTs in team order, fixed at entry
	created time.Time
	match   *queueMatch // set once paired, until the waiting player polls it
}

type queueMatch struct {
	ID       string       `json:"id"`
	Token    string       `json:"token"`
	Side     string       `json:"side"`
	Opponent queueRequest `json:"opponent"`
	You      queueRequest `json:"you"`
}

func matched(m queueMatch) map[string]any {
	return map[string]any{"status": "matched", "id": m.ID, "token": m.Token, "side": m.Side, "opponent": m.Opponent, "you": m.You}
}

// enqueue pairs the caller with a compatible waiting player, or adds them to
// the queue and returns a ticket to poll.
func (s *Server) enqueue(w http.ResponseWriter, r *http.Request) {
	var req queueRequest
	if !decodeBattle(w, r, &req) {
		return
	}
	if err := req.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	seat := seatTerms{Assets: make([]string, len(req.Team))}
	owner := ""
	for i := range req.Team {
		pick := &req.Team[i]
		if !s.verifyArenaAsset(w, r, pick.Species, pick.AssetID, pick.Wallet) {
			return
		}
		if pick.AssetID != "" {
			if owner != "" && owner != pick.Wallet {
				writeError(w, http.StatusBadRequest, "every owned card in a team must belong to the same wallet")
				return
			}
			if slices.Contains(seat.Assets, pick.AssetID) {
				writeError(w, http.StatusBadRequest, "a card can fill only one team slot")
				return
			}
			owner = pick.Wallet
		}
		seat.Assets[i] = pick.AssetID
		pick.Rental = pick.AssetID == ""
		pick.AssetID, pick.Wallet = "", "" // verification credentials are private
	}
	req.Trainer.Name = strings.TrimSpace(req.Trainer.Name)
	record := s.playerRecord(req.Trainer.Name)
	req.Rating, req.Wins, req.Losses = record.Rating, record.Wins, record.Losses
	tokens, err := randomTokens(2)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not join the queue")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneQueue(time.Now())
	for _, entry := range s.waiting {
		if strings.EqualFold(entry.req.Trainer.Name, req.Trainer.Name) {
			writeError(w, http.StatusConflict, "this player is already searching")
			return
		}
	}
	if !s.claimAssetsLocked(w, seat) {
		return
	}
	now := time.Now()
	entry := &queueEntry{ticket: tokens[0], req: req, seat: seat, created: now}
	if waiter := s.teamOpponentLocked(entry, now); waiter != nil {
		match, err := s.pairTeamLocked(waiter, entry, tokens)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not create battle")
			return
		}
		writeJSON(w, http.StatusOK, matched(match))
		return
	}
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
		writeJSON(w, http.StatusOK, matched(*entry.match))
	default:
		// The band widens while searching, so a poll may pair two waiting players.
		if waiter := s.teamOpponentLocked(entry, time.Now()); waiter != nil {
			tokens, err := randomTokens(2)
			if err == nil {
				s.removeWaiter(entry)
				var match queueMatch
				if match, err = s.pairTeamLocked(waiter, entry, tokens); err == nil {
					entry.match, entry.created = &match, time.Now()
					writeJSON(w, http.StatusOK, matched(match))
					return
				}
				s.waiting = append(s.waiting, entry) // keep searching after a failed start
			}
		}
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

// teamOpponentLocked returns the longest-waiting player with the same format,
// tier and entry whose rating is within the band (see rating_band.go). s.waiting
// is oldest first. s.mu must be held.
func (s *Server) teamOpponentLocked(entry *queueEntry, now time.Time) *queueEntry {
	for _, waiter := range s.waiting {
		if waiter != entry && waiter.req.key() == entry.req.key() &&
			!strings.EqualFold(waiter.req.Trainer.Name, entry.req.Trainer.Name) &&
			withinRatingBand(waiter.req.Rating, entry.req.Rating, now.Sub(waiter.created), now.Sub(entry.created)) {
			return waiter
		}
	}
	return nil
}

// pairTeamLocked starts a two-player battle with the waiting player as p1 and
// returns p2's match; tokens are p1's and p2's battle tokens. s.mu must be held.
func (s *Server) pairTeamLocked(waiter, entry *queueEntry, tokens []string) (queueMatch, error) {
	id, err := s.newBattleID()
	if err != nil {
		return queueMatch{}, err
	}
	b, err := livebattle.New(id, livebattle.Config{Mode: livebattle.ModePvP, You: waiter.req.Trainer, Opponent: entry.req.Trainer,
		Teams: map[string][]livebattle.Creature{"p1": waiter.req.creatures("p1"), "p2": entry.req.creatures("p2")}})
	if err != nil {
		return queueMatch{}, err
	}
	b.SetToken("p1", tokens[0])
	b.SetToken("p2", tokens[1])
	s.battles[id] = b
	s.removeWaiter(waiter)
	s.setTermsLocked(teamTermsKey(id), matchTerms{EntryCents: entryCents(entry.req.Entry), Seats: [2]seatTerms{waiter.seat, entry.seat}})
	waiter.match = &queueMatch{ID: id, Token: tokens[0], Side: "p1", Opponent: entry.req, You: waiter.req}
	waiter.created = time.Now() // give the waiting player a full TTL to collect the match
	return queueMatch{ID: id, Token: tokens[1], Side: "p2", Opponent: waiter.req, You: entry.req}, nil
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
