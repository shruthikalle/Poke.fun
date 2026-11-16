package server

import (
	"net/http"

	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
)

func (s *Server) battleForfeit(w http.ResponseWriter, r *http.Request) {
	s.act(w, r, func(game *livebattle.Battle, side string) error { return game.Forfeit(side) })
}
