package server

import (
	"net/http"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
)

// finishArena is called under s.mu. Never publish an outcome until its
// immutable handoff is durable; retries are safe for both stores.
func (s *Server) finishArena(game *arena.Game) error {
	if game.Winner == "" {
		return nil
	}
	game.ResultReason()
	if err := s.sealArenaResult(game); err != nil {
		return err
	}
	return s.recordArenaResult(game)
}

func (s *Server) recordArenaResult(game *arena.Game) error {
	if game.Winner == "" || game.Fighters[1] == nil {
		return nil
	}
	return s.recordPlayerResult("arena:"+game.ID, game.Fighters[0].Name, game.Fighters[1].Name, game.Winner)
}

func (s *Server) arenaForfeit(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	game, index := s.authenticatedArena(r)
	if game == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "arena or player token not found")
		return
	}
	if err := game.Forfeit(index); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err := s.finishArena(game); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusServiceUnavailable, "arena result could not be saved; retry")
		return
	}
	s.broadcastArena(game.ID)
	view := game.ViewFor(index)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, view)
}
