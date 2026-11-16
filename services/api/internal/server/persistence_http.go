package server

import (
	"bytes"
	"net/http"
	"strings"
)

// Buffer only game HTTP endpoints. WebSocket upgrades must retain the real
// writer's Hijacker; socket simulation uses checkpointArenaLocked instead.
func (s *Server) durableResponses(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !gameRequest(r) || s.games == nil {
			next.ServeHTTP(w, r)
			return
		}
		s.persistenceGate.Lock()
		defer s.persistenceGate.Unlock()
		s.mu.Lock()
		closed := s.closed
		var err error
		if s.persistenceErr != nil {
			err = s.checkpointLocked()
		}
		s.mu.Unlock()
		if closed || err != nil {
			writeError(w, http.StatusServiceUnavailable, "game storage is unavailable; retry")
			return
		}
		buffer := &gameResponse{header: make(http.Header)}
		next.ServeHTTP(buffer, r)
		// Timeouts and queue heartbeats may mutate on GET. Checkpoint even after
		// an invalid action, since its preceding timeout may have advanced play.
		s.mu.Lock()
		err = s.checkpointLocked()
		s.mu.Unlock()
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "game could not be saved; retry")
			return
		}
		for key, values := range buffer.header {
			w.Header()[key] = values
		}
		status := buffer.status
		if status == 0 {
			status = http.StatusOK
		}
		w.WriteHeader(status)
		_, _ = w.Write(buffer.body.Bytes())
	})
}

func gameRequest(r *http.Request) bool {
	path := r.URL.Path
	if strings.HasSuffix(path, "/ws") {
		return false
	}
	for _, prefix := range []string{"/api/matches", "/api/battles", "/api/arenas", "/api/queue", "/api/arena-queue"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

type gameResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *gameResponse) Header() http.Header { return w.header }
func (w *gameResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *gameResponse) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(data)
}
