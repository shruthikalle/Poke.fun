package server

import (
	"errors"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"net/http"
	"strings"
	"time"
)

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
	match.ApplyTimeout(time.Now())
	if err := s.sealDuelResult(match); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusServiceUnavailable, "authoritative result could not be saved; retry")
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
	match.ApplyTimeout(time.Now())
	err := match.Submit(index, req.AttackID)
	if err := s.sealDuelResult(match); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusServiceUnavailable, "authoritative result could not be saved; retry")
		return
	}
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
