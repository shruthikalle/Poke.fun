package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

// Rich team battle endpoints. A battle keeps a shared, append-only event log;
// each client polls it (GET …/events?since=N) and submits its own side's hidden
// choices with the token that identifies that side. Single-player battles are
// created here directly against the AI; two-player battles are created by
// matchmaking (matchmaking.go), after which each player submits their team.

// createBattle starts a single-player battle against the server AI. The client
// sends both teams (its own and the bot's).
func (s *Server) createBattle(w http.ResponseWriter, r *http.Request) {
	var cfg livebattle.Config
	if !decodeBattle(w, r, &cfg) {
		return
	}
	cfg.Mode = livebattle.ModeAI
	token, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create battle")
		return
	}
	s.mu.Lock()
	id, err := s.newBattleID()
	if err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not create battle")
		return
	}
	b, err := livebattle.New(id, cfg)
	if err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	b.SetToken("p1", token)
	s.battles[id] = b
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "token": token, "side": "p1"})
}

// battleEvents returns the log entries after ?since=N. Polling also advances
// any turn whose deadline has passed, so a stalled player can't freeze a match.
func (s *Server) battleEvents(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.Atoi(r.URL.Query().Get("since"))
	s.mu.Lock()
	b, side := s.authedBattle(r)
	if b == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "battle or token not found")
		return
	}
	b.ApplyTimeout(time.Now())
	if err := s.recordLiveResult(b); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not save ranked result")
		return
	}
	events, cursor := b.EventsSince(since)
	started := b.Started()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "cursor": cursor, "side": side, "started": started})
}

// battleTeam submits a two-player battle's team for the caller's side.
func (s *Server) battleTeam(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Team   []livebattle.Creature `json:"team"`
		Format livebattle.Format     `json:"format"`
	}
	if !decodeBattle(w, r, &req) {
		return
	}
	s.act(w, r, func(b *livebattle.Battle, side string) error { return b.SetTeam(side, req.Team, req.Format) })
}

func (s *Server) battleChoice(w http.ResponseWriter, r *http.Request) {
	var choice livebattle.Choice
	if !decode(w, r, &choice) {
		return
	}
	s.act(w, r, func(b *livebattle.Battle, side string) error { return b.SubmitChoice(side, choice) })
}

func (s *Server) battleTimer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if !decode(w, r, &req) {
		return
	}
	s.act(w, r, func(b *livebattle.Battle, side string) error { b.SetTimer(side, req.Enabled); return nil })
}

func (s *Server) battleChat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &req) {
		return
	}
	text := strings.TrimSpace(req.Text)
	if len(text) > 300 {
		text = text[:300]
	}
	s.act(w, r, func(b *livebattle.Battle, side string) error {
		if text != "" {
			b.Chat(side, text)
		}
		return nil
	})
}

// battleRematch restarts a battle. In a two-player battle it is only allowed
// once the match is over, so neither player can wipe a battle in progress.
func (s *Server) battleRematch(w http.ResponseWriter, r *http.Request) {
	s.act(w, r, func(b *livebattle.Battle, side string) error { return b.RequestRematch(side) })
}

// act authenticates the caller's side, runs fn under the server lock and maps
// engine errors to HTTP statuses. Results reach clients through the event log.
func (s *Server) act(w http.ResponseWriter, r *http.Request, fn func(b *livebattle.Battle, side string) error) {
	s.mu.Lock()
	b, side := s.authedBattle(r)
	if b == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "battle or token not found")
		return
	}
	b.ApplyTimeout(time.Now())
	if err := s.recordLiveResult(b); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not save ranked result")
		return
	}
	err := fn(b, side)
	if recordErr := s.recordLiveResult(b); recordErr != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not save ranked result")
		return
	}
	s.mu.Unlock()
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case errors.Is(err, livebattle.ErrFinished), errors.Is(err, livebattle.ErrNotYourTurn), errors.Is(err, livebattle.ErrNotStarted):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusBadRequest, err.Error())
	}
}

// authedBattle resolves the battle and the side the bearer token controls. It
// must be called while s.mu is held.
func (s *Server) authedBattle(r *http.Request) (*livebattle.Battle, string) {
	b := s.battles[strings.ToUpper(r.PathValue("id"))]
	header := r.Header.Get("Authorization")
	if b == nil || !strings.HasPrefix(header, "Bearer ") {
		return nil, ""
	}
	side := b.SideFor(strings.TrimPrefix(header, "Bearer "))
	if side == "" {
		return nil, ""
	}
	return b, side
}

// newBattleID returns an unused battle code. It must be called while s.mu is held.
func (s *Server) newBattleID() (string, error) {
	for {
		code, err := randomCode()
		if err != nil {
			return "", err
		}
		if s.battles[code] == nil {
			return code, nil
		}
	}
}

// decodeBattle reads a battle payload. Unlike decode, it allows a larger body
// (full creature teams with sprite URLs) and ignores unknown fields so the
// client creature shape can evolve without breaking battle creation.
func decodeBattle(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid battle payload")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "only one JSON object is allowed")
		return false
	}
	return true
}

// species exposes the same versioned definitions used to construct battles.
func (s *Server) species(w http.ResponseWriter, r *http.Request) {
	entry, ok := pokedex.Lookup(r.PathValue("key"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown species")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"key": entry.Key, "dex": entry.Dex, "name": entry.Name, "tier": entry.Tier, "types": entry.Types, "base": entry.Base,
		"moves": livebattle.SpeciesMoves(entry), "sprites": livebattle.SpeciesSprites(entry), "artwork": entry.Sprite, "cry": nil,
		"version": pokedex.Version(),
	})
}
