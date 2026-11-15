package server

import (
	"compress/gzip"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
)

type arenaPeer struct {
	index   int
	updates chan arena.View
}

func (s *Server) createArena(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusInternalServerError, "could not create arena")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for {
		code, err := randomCode()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not create arena")
			return
		}
		if s.arenas[code] != nil {
			continue
		}
		game, err := arena.New(code, strings.TrimSpace(req.Name), req.CardID, token)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.arenas[code] = game
		writeJSON(w, http.StatusCreated, map[string]string{"id": code, "token": token})
		return
	}
}

func (s *Server) joinArena(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusInternalServerError, "could not join arena")
		return
	}
	id := strings.ToUpper(r.PathValue("id"))
	s.mu.Lock()
	game := s.arenas[id]
	if game == nil {
		s.mu.Unlock()
		writeError(w, http.StatusNotFound, "arena not found")
		return
	}
	if err := game.Join(strings.TrimSpace(req.Name), req.CardID, token); err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	s.broadcastArena(id)
	s.mu.Unlock()
	go s.runArena(id)
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "token": token})
}

func (s *Server) getArena(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	game, index := s.authenticatedArena(r)
	if game == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "arena or player token not found")
		return
	}
	view := game.ViewFor(index)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) authenticatedArena(r *http.Request) (*arena.Game, int) {
	game := s.arenas[strings.ToUpper(r.PathValue("id"))]
	header := r.Header.Get("Authorization")
	if game == nil || !strings.HasPrefix(header, "Bearer ") {
		return nil, -1
	}
	index := game.PlayerIndex(strings.TrimPrefix(header, "Bearer "))
	if index < 0 {
		return nil, -1
	}
	return game, index
}

func (s *Server) runArena(id string) {
	ticker := time.NewTicker(arena.TickMs * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		game := s.arenas[id]
		if game == nil {
			s.mu.Unlock()
			return
		}
		game.Step()
		if game.Tick%2 == 0 || game.Winner != "" {
			s.broadcastArena(id)
		}
		finished := game.Winner != ""
		s.mu.Unlock()
		if finished {
			return
		}
	}
}

// broadcastArena is called with s.mu held; each viewer receives its own perspective.
func (s *Server) broadcastArena(id string) {
	game := s.arenas[id]
	for peer := range s.peers[id] {
		view := game.ViewFor(peer.index)
		select {
		case peer.updates <- view:
		default:
			select {
			case <-peer.updates:
			default:
			}
			select {
			case peer.updates <- view:
			default:
			}
		}
	}
}

func (s *Server) arenaSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == s.origin }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(1024)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var auth struct {
		Type  string `json:"type"`
		Token string `json:"token"`
	}
	if err := conn.ReadJSON(&auth); err != nil || auth.Type != "auth" {
		return
	}
	id := strings.ToUpper(r.PathValue("id"))
	s.mu.Lock()
	game := s.arenas[id]
	index := -1
	if game != nil {
		index = game.PlayerIndex(auth.Token)
	}
	if index < 0 {
		s.mu.Unlock()
		_ = conn.WriteJSON(map[string]string{"error": "invalid player token"})
		return
	}
	peer := &arenaPeer{index: index, updates: make(chan arena.View, 3)}
	if s.peers[id] == nil {
		s.peers[id] = make(map[*arenaPeer]struct{})
	}
	s.peers[id][peer] = struct{}{}
	peer.updates <- game.ViewFor(index)
	s.mu.Unlock()
	go func() {
		for view := range peer.updates {
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteJSON(view); err != nil {
				_ = conn.Close()
				return
			}
		}
	}()
	defer func() {
		s.mu.Lock()
		delete(s.peers[id], peer)
		close(peer.updates)
		// A disconnected player stops moving unless another connection uses the same token.
		connected := false
		for other := range s.peers[id] {
			if other.index == index {
				connected = true
				break
			}
		}
		if !connected && s.arenas[id] != nil {
			s.arenas[id].SetInput(index, arena.Input{})
		}
		s.mu.Unlock()
	}()
	for {
		_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var input arena.Input
		if len(data) > 1024 || json.Unmarshal(data, &input) != nil {
			continue
		}
		s.mu.Lock()
		if current := s.arenas[id]; current != nil {
			current.SetInput(index, input)
		}
		s.mu.Unlock()
	}
}

// arenaCards lists every live-arena fighter (over 1,200, about 650 KB), or with
// ?ids=pikachu,charmander just those, so a page that needs a few fighters
// doesn't download the whole roster. Unknown ids are skipped.
func arenaCards(w http.ResponseWriter, r *http.Request) {
	ids := r.URL.Query().Get("ids")
	if ids == "" {
		writeCompressedJSON(w, r, arena.Cards())
		return
	}
	cards := []arena.Card{}
	for _, id := range strings.Split(ids, ",") {
		if c, ok := arena.FindCard(strings.TrimSpace(id)); ok {
			cards = append(cards, c)
		}
	}
	writeJSON(w, http.StatusOK, cards)
}

// writeCompressedJSON gzips a large response for clients that accept it (every
// browser does); the full fighter list shrinks by about 90%.
func writeCompressedJSON(w http.ResponseWriter, r *http.Request, value any) {
	if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		writeJSON(w, http.StatusOK, value)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	gz := gzip.NewWriter(w)
	defer gz.Close()
	_ = json.NewEncoder(gz).Encode(value)
}
