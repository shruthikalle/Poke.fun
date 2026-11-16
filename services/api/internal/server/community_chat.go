package server

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
)

func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string `json:"name"`
		RoomID string `json:"roomId"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !playerstore.ValidName(req.Name) {
		writeError(w, http.StatusBadRequest, "a public demo name of 1–24 characters is required")
		return
	}
	if req.RoomID == "" {
		req.RoomID = "lobby"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.prunePresence(now)
	if !s.knownRoom(req.RoomID) {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	p := s.community.presence[token]
	if token != "" && p == nil {
		writeError(w, http.StatusUnauthorized, "presence expired; reconnect")
		return
	}
	if p != nil && p.name != strings.TrimSpace(req.Name) {
		writeError(w, http.StatusConflict, "presence belongs to a different demo name")
		return
	}
	if p == nil {
		var err error
		token, err = randomToken()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not join community")
			return
		}
		p = &communityPresence{name: strings.TrimSpace(req.Name), rooms: map[string]time.Time{}}
		s.community.presence[token] = p
	}
	p.seen, p.rooms[req.RoomID] = now, now
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "name": p.name, "expiresInMs": presenceTTL.Milliseconds()})
}

func (s *Server) leaveCommunity(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prunePresence(time.Now())
	delete(s.community.presence, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) roomMessages(w http.ResponseWriter, r *http.Request) {
	since := int64(0)
	if raw := r.URL.Query().Get("since"); raw != "" {
		var err error
		since, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || since < 0 {
			writeError(w, http.StatusBadRequest, "invalid message cursor")
			return
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prunePresence(time.Now())
	id := r.PathValue("room")
	if !s.knownRoom(id) {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}
	messages := []roomMessage{}
	for _, m := range s.community.messages[id] {
		if m.ID > since {
			messages = append(messages, m)
		}
	}
	names := map[string]bool{}
	for _, p := range s.community.presence {
		if _, ok := p.rooms[id]; ok {
			names[strings.ToLower(p.name)] = true
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages, "cursor": s.community.sequence, "users": len(names)})
}

func (s *Server) sendRoomMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &req) {
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > 300 {
		writeError(w, http.StatusBadRequest, "message must be 1–300 characters")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.prunePresence(now)
	id := r.PathValue("room")
	if !s.knownRoom(id) {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}
	p := s.community.presence[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	if p == nil {
		writeError(w, http.StatusUnauthorized, "join community before sending a message")
		return
	}
	if _, ok := p.rooms[id]; !ok {
		writeError(w, http.StatusForbidden, "join this room before sending a message")
		return
	}
	p.seen, p.rooms[id] = now, now
	s.community.sequence++
	m := roomMessage{ID: s.community.sequence, User: p.name, Text: text, At: now.UnixMilli()}
	history := append(s.community.messages[id], m)
	if len(history) > roomHistoryLimit {
		history = history[len(history)-roomHistoryLimit:]
	}
	s.community.messages[id] = history
	writeJSON(w, http.StatusCreated, m)
}
