package server

import (
	"net/http"

	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
)

// History is indexed by public demo name until wallet identity is integrated.
func (s *Server) matchHistory(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("player")
	if !playerstore.ValidName(name) {
		writeError(w, http.StatusBadRequest, "player must be a public demo name of 1–24 characters")
		return
	}
	store, err := s.resultStore()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "result store is unavailable")
		return
	}
	results := []resultstore.Result{}
	for _, record := range store.List(name) {
		results = append(results, record.Result)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "namespace": "Public demo names on this server; names are not verified accounts."})
}

func (s *Server) matchReplay(w http.ResponseWriter, r *http.Request) {
	store, err := s.resultStore()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "result store is unavailable")
		return
	}
	record, ok := store.Get(r.PathValue("id"))
	if !ok || len(record.Replay) == 0 {
		writeError(w, http.StatusNotFound, "replay not found")
		return
	}
	writeJSON(w, http.StatusOK, record)
}
