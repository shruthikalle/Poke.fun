package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
)

// Live (rich team) battle endpoints. The client builds creature teams from
// PokéAPI and posts them here; the server runs the authoritative battle and
// returns the ordered events the client reducer applies. This replaces the
// client-side MockBattleStream.

func (s *Server) createBattle(w http.ResponseWriter, r *http.Request) {
	var cfg livebattle.Config
	if !decodeBattle(w, r, &cfg) {
		return
	}
	s.mu.Lock()
	code, err := randomCode()
	if err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not create battle")
		return
	}
	for s.battles[code] != nil {
		if code, err = randomCode(); err != nil {
			s.mu.Unlock()
			writeError(w, http.StatusInternalServerError, "could not create battle")
			return
		}
	}
	token, err := randomToken()
	if err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not create battle")
		return
	}
	b, err := livebattle.New(code, token, cfg)
	if err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.battles[code] = b
	events := b.Open()
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]any{"id": code, "token": token, "events": events})
}

func (s *Server) battleChoice(w http.ResponseWriter, r *http.Request) {
	var choice livebattle.Choice
	if !decode(w, r, &choice) {
		return
	}
	s.mu.Lock()
	b := s.authedBattle(r)
	if b == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "battle or token not found")
		return
	}
	events, err := b.Choose(choice)
	s.mu.Unlock()
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, livebattle.ErrFinished) || errors.Is(err, livebattle.ErrNotYourTurn) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) battleTimer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if !decode(w, r, &req) {
		return
	}
	s.withBattle(w, r, func(b *livebattle.Battle) []livebattle.Event { return b.SetTimer(req.Enabled) })
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
	if text == "" {
		writeJSON(w, http.StatusOK, map[string]any{"events": []livebattle.Event{}})
		return
	}
	s.withBattle(w, r, func(b *livebattle.Battle) []livebattle.Event { return b.Chat(text) })
}

func (s *Server) battleRematch(w http.ResponseWriter, r *http.Request) {
	s.withBattle(w, r, func(b *livebattle.Battle) []livebattle.Event { return b.Open() })
}

// withBattle authenticates the battle and returns the events from fn.
func (s *Server) withBattle(w http.ResponseWriter, r *http.Request, fn func(*livebattle.Battle) []livebattle.Event) {
	s.mu.Lock()
	b := s.authedBattle(r)
	if b == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "battle or token not found")
		return
	}
	events := fn(b)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

// authedBattle must be called while s.mu is held.
func (s *Server) authedBattle(r *http.Request) *livebattle.Battle {
	b := s.battles[strings.ToUpper(r.PathValue("id"))]
	header := r.Header.Get("Authorization")
	if b == nil || !strings.HasPrefix(header, "Bearer ") {
		return nil
	}
	if strings.TrimPrefix(header, "Bearer ") != b.Token {
		return nil
	}
	return b
}

// decodeBattle reads a battle config. Unlike decode, it allows a larger body
// (full creature teams with sprite URLs) and ignores unknown fields so the
// client creature shape can evolve without breaking battle creation.
func decodeBattle(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid battle setup")
		return false
	}
	return true
}
