package server

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

type Server struct {
	mu           sync.Mutex
	matches      map[string]*battle.Match
	arenas       map[string]*arena.Game
	peers        map[string]map[*arenaPeer]struct{}
	queue        map[string]*arenaQueueEntry
	origin       string
	collectibles collectibleReader
}

type collectibleReader interface {
	Read(context.Context, string, string) (collectibles.Card, error)
}

type playerRequest struct {
	Name   string `json:"name"`
	CardID string `json:"cardId"`
}

type attackRequest struct {
	AttackID string `json:"attackId"`
}

func New(origin string) http.Handler {
	return NewWithCollectibles(origin, nil)
}

func NewWithCollectibles(origin string, reader collectibleReader) http.Handler {
	s := &Server{matches: make(map[string]*battle.Match), arenas: make(map[string]*arena.Game), peers: make(map[string]map[*arenaPeer]struct{}), queue: make(map[string]*arenaQueueEntry), origin: origin, collectibles: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/cards", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, battle.Cards())
	})
	mux.HandleFunc("POST /api/matches", s.createMatch)
	mux.HandleFunc("POST /api/matches/{id}/join", s.joinMatch)
	mux.HandleFunc("GET /api/matches/{id}", s.getMatch)
	mux.HandleFunc("POST /api/matches/{id}/attacks", s.submitAttack)
	mux.HandleFunc("GET /api/arena-cards", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, arena.Cards())
	})
	mux.HandleFunc("GET /api/collectibles/{id}", s.getCollectible)
	mux.HandleFunc("POST /api/arenas", s.createArena)
	mux.HandleFunc("POST /api/arenas/{id}/join", s.joinArena)
	mux.HandleFunc("GET /api/arenas/{id}", s.getArena)
	mux.HandleFunc("GET /api/arenas/{id}/ws", s.arenaSocket)
	mux.HandleFunc("POST /api/arena-queue", s.enqueueArena)
	mux.HandleFunc("GET /api/arena-queue/{id}", s.getArenaQueue)
	mux.HandleFunc("DELETE /api/arena-queue/{id}", s.cancelArenaQueue)
	return s.withCORS(mux)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") == s.origin {
			w.Header().Set("Access-Control-Allow-Origin", s.origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) createMatch(w http.ResponseWriter, r *http.Request) {
	var req playerRequest
	if !decode(w, r, &req) {
		return
	}
	if !validName(req.Name) {
		writeError(w, http.StatusBadRequest, "name must be 1–24 characters")
		return
	}
	code, err := randomCode()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create match")
		return
	}
	token, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create match")
		return
	}
	match, err := battle.NewMatch(code, strings.TrimSpace(req.Name), req.CardID, token)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.mu.Lock()
	for s.matches[code] != nil {
		code, err = randomCode()
		if err != nil {
			s.mu.Unlock()
			writeError(w, http.StatusInternalServerError, "could not create match")
			return
		}
		match.ID = code
	}
	s.matches[code] = match
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]string{"id": code, "token": token})
}

func (s *Server) joinMatch(w http.ResponseWriter, r *http.Request) {
	var req playerRequest
	if !decode(w, r, &req) {
		return
	}
	if !validName(req.Name) {
		writeError(w, http.StatusBadRequest, "name must be 1–24 characters")
		return
	}
	token, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not join match")
		return
	}
	id := strings.ToUpper(r.PathValue("id"))
	s.mu.Lock()
	match := s.matches[id]
	if match == nil {
		s.mu.Unlock()
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	err = match.Join(strings.TrimSpace(req.Name), req.CardID, token)
	s.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "token": token})
}

func (s *Server) getMatch(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	match, index := s.authenticatedMatch(r)
	if match == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "match or player token not found")
		return
	}
	view := match.ViewFor(index)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) submitAttack(w http.ResponseWriter, r *http.Request) {
	var req attackRequest
	if !decode(w, r, &req) {
		return
	}
	s.mu.Lock()
	match, index := s.authenticatedMatch(r)
	if match == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "match or player token not found")
		return
	}
	err := match.Submit(index, req.AttackID)
	view := match.ViewFor(index)
	s.mu.Unlock()
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, battle.ErrAlreadyPlayed) || errors.Is(err, battle.ErrFinished) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// authenticatedMatch must be called while s.mu is held.
func (s *Server) authenticatedMatch(r *http.Request) (*battle.Match, int) {
	match := s.matches[strings.ToUpper(r.PathValue("id"))]
	header := r.Header.Get("Authorization")
	if match == nil || !strings.HasPrefix(header, "Bearer ") {
		return nil, -1
	}
	index := match.PlayerIndex(strings.TrimPrefix(header, "Bearer "))
	if index < 0 {
		return nil, -1
	}
	return match, index
}

func validName(name string) bool {
	name = strings.TrimSpace(name)
	return len(name) >= 1 && len(name) <= 24
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "only one JSON object is allowed")
		return false
	}
	return true
}

func randomCode() (string, error) {
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
