package server

import (
	"fmt"
	"net/http"

	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
)

func (s *Server) playerStore() *playerstore.Store {
	s.playerInit.Do(func() {
		if s.players == nil {
			s.players, _ = playerstore.Open("")
		}
	})
	return s.players
}

func (s *Server) playerRecord(name string) playerstore.RankInfo { return s.playerStore().Rank(name) }
func (s *Server) playerRating(name string) int                  { return s.playerRecord(name).Rating }

// recordPlayerResult can be called while s.mu is held. It has its own store
// lock. Arena winners (player1/player2) and team winners (p1/p2) are accepted.
// Use a stable, namespaced ID such as "arena:"+game.ID for retry-safe recording.
func (s *Server) recordPlayerResult(id, p1, p2, winner string) error {
	return s.playerStore().Record(id, p1, p2, winner)
}

// recordLiveResult only ranks server-adjudicated human battles. Each rematch
// gets a separate result ID; polling and duplicate requests cannot award twice.
func (s *Server) recordLiveResult(b *livebattle.Battle) error {
	winner, over := b.Result()
	if !over {
		return nil
	}
	if err := s.sealLiveResult(b); err != nil {
		return err
	}
	if b.Mode() != livebattle.ModePvP {
		return nil
	}
	p1, p2 := b.Trainers()
	return s.recordPlayerResult(fmt.Sprintf("team:%s:%d", b.ID, b.Round()), p1.Name, p2.Name, winner)
}

func (s *Server) ranks(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("player")
	if !playerstore.ValidName(name) {
		writeError(w, http.StatusBadRequest, "player must be a public demo name of 1–24 characters")
		return
	}
	writeJSON(w, http.StatusOK, s.playerRecord(name))
}

func (s *Server) leaderboard(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"entries": s.playerStore().Leaderboard(), "namespace": "Public demo names on this server; names are not verified accounts."})
}
