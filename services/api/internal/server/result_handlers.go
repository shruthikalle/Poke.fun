package server

import (
	"fmt"
	"net/http"
	"time"
)

func (s *Server) arenaResult(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	game, _ := s.authenticatedArena(r)
	if game == nil {
		writeError(w, http.StatusUnauthorized, "arena or player token not found")
		return
	}
	s.writeSealedResult(w, "arena:"+game.ID, game.Winner != "", func() error { return s.sealArenaResult(game) })
}

func (s *Server) teamResult(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	game, _ := s.authedBattle(r)
	if game == nil {
		writeError(w, http.StatusUnauthorized, "battle or player token not found")
		return
	}
	game.ApplyTimeout(time.Now())
	id := fmt.Sprintf("team:%s:%d", game.ID, game.Round())
	s.writeSealedResult(w, id, game.Over(), func() error { return s.sealLiveResult(game) })
}

func (s *Server) duelResult(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	game, _ := s.authenticatedMatch(r)
	if game == nil {
		writeError(w, http.StatusUnauthorized, "match or player token not found")
		return
	}
	game.ApplyTimeout(time.Now())
	s.writeSealedResult(w, "duel:"+game.ID, game.Winner != "", func() error { return s.sealDuelResult(game) })
}

func (s *Server) writeSealedResult(w http.ResponseWriter, id string, finished bool, seal func() error) {
	if !finished {
		writeError(w, http.StatusConflict, "the match has no final result yet")
		return
	}
	if err := seal(); err != nil {
		writeError(w, http.StatusServiceUnavailable, "authoritative result could not be saved; retry")
		return
	}
	store, err := s.resultStore()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "result store is unavailable")
		return
	}
	envelope, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "final result is not available yet")
		return
	}
	writeJSON(w, http.StatusOK, envelope)
}
