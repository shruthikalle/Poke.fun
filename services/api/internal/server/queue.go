package server

import (
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

type arenaQueueEntry struct {
	id, token, playerToken string
	name, cardID           string
	tier                   int // the fighter's power tier; only equal tiers are paired
	rating                 int
	entryCents             int
	created                time.Time
	lastSeen               time.Time
	match                  *arenaSession
	opponent               string
}

const arenaQueueHeartbeatTimeout = 20 * time.Second

type arenaSession struct {
	ID         string `json:"id"`
	Token      string `json:"token"`
	EntryCents int    `json:"entryCents"`
}

type arenaQueueResponse struct {
	ID         string        `json:"id"`
	Token      string        `json:"token,omitempty"`
	Status     string        `json:"status"`
	EntryCents int           `json:"entryCents"`
	Arena      *arenaSession `json:"arena,omitempty"`
	Opponent   string        `json:"opponent,omitempty"`
}

func (q *arenaQueueEntry) response(includeToken bool) arenaQueueResponse {
	status := "waiting"
	if q.match != nil {
		status = "matched"
	}
	response := arenaQueueResponse{ID: q.id, Status: status, EntryCents: q.entryCents, Arena: q.match, Opponent: q.opponent}
	if includeToken {
		response.Token = q.token
	}
	return response
}

func (s *Server) enqueueArena(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		CardID     string `json:"cardId"`
		Rating     int    `json:"rating"`
		EntryCents int    `json:"entryCents"`
		AssetID    string `json:"assetId"`
		Wallet     string `json:"walletAddress"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !validName(req.Name) || req.Rating < 0 || req.Rating > 5000 || req.EntryCents < 0 || req.EntryCents > 10000 {
		writeError(w, http.StatusBadRequest, "invalid name, rating, or demo entry")
		return
	}
	fighter, ok := arena.FindCard(req.CardID)
	if !ok {
		writeError(w, http.StatusBadRequest, "card is not supported in the live arena")
		return
	}
	if (req.AssetID == "") != (req.Wallet == "") {
		writeError(w, http.StatusBadRequest, "assetId and walletAddress are required together")
		return
	}
	if req.AssetID != "" {
		if s.collectibles == nil {
			writeError(w, http.StatusServiceUnavailable, "NFT reader is not configured")
			return
		}
		card, err := s.collectibles.Read(r.Context(), req.AssetID, req.Wallet)
		if err != nil {
			writeCollectibleError(w, err)
			return
		}
		if card.Attribute("Category") != "Pokemon" || nftSpecies(card) != req.CardID {
			writeError(w, http.StatusForbidden, "NFT does not match the selected fighter")
			return
		}
	}
	token, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not enter queue")
		return
	}
	playerToken, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not enter queue")
		return
	}
	s.mu.Lock()
	var id string
	for {
		id, err = randomCode()
		if err != nil {
			s.mu.Unlock()
			writeError(w, http.StatusInternalServerError, "could not enter queue")
			return
		}
		if s.arenaQueue[id] == nil {
			break
		}
	}
	now := time.Now()
	s.pruneWaitingQueue(now)
	entry := &arenaQueueEntry{id: id, token: token, playerToken: playerToken, name: strings.TrimSpace(req.Name), cardID: req.CardID, tier: fighter.Tier, rating: req.Rating, entryCents: req.EntryCents, created: now, lastSeen: now}
	var best *arenaQueueEntry
	for _, candidate := range s.arenaQueue {
		// Same stake and same power tier (PRD: comparable cards first), then
		// the closest rating.
		if candidate.match != nil || candidate.entryCents != req.EntryCents || candidate.tier != fighter.Tier {
			continue
		}
		if best == nil || math.Abs(float64(candidate.rating-req.Rating)) < math.Abs(float64(best.rating-req.Rating)) ||
			(candidate.rating == best.rating && candidate.created.Before(best.created)) {
			best = candidate
		}
	}
	if best == nil {
		s.arenaQueue[id] = entry
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, entry.response(true))
		return
	}
	var matchID string
	for {
		matchID, err = randomCode()
		if err != nil {
			s.mu.Unlock()
			writeError(w, http.StatusInternalServerError, "could not create match")
			return
		}
		if s.arenas[matchID] == nil {
			break
		}
	}
	game, err := arena.New(matchID, best.name, best.cardID, best.playerToken)
	if err == nil {
		err = game.Join(entry.name, entry.cardID, entry.playerToken)
	}
	if err != nil {
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not create match")
		return
	}
	s.arenas[matchID] = game
	best.match = &arenaSession{ID: matchID, Token: best.playerToken, EntryCents: req.EntryCents}
	best.opponent = entry.name
	entry.match = &arenaSession{ID: matchID, Token: entry.playerToken, EntryCents: req.EntryCents}
	entry.opponent = best.name
	s.arenaQueue[id] = entry
	response := entry.response(true)
	s.mu.Unlock()
	go s.runArena(matchID)
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) getArenaQueue(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	entry := s.authorizedQueue(r)
	if entry == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "queue entry not found")
		return
	}
	if entry.match == nil && time.Since(entry.lastSeen) > arenaQueueHeartbeatTimeout {
		delete(s.arenaQueue, entry.id)
		s.mu.Unlock()
		writeError(w, http.StatusGone, "queue entry expired; search again")
		return
	}
	entry.lastSeen = time.Now()
	response := entry.response(false)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, response)
}

// pruneWaitingQueue is called with s.mu held. Matched tickets remain available for reconnects.
func (s *Server) pruneWaitingQueue(now time.Time) {
	for id, entry := range s.arenaQueue {
		if entry.match == nil && now.Sub(entry.lastSeen) > arenaQueueHeartbeatTimeout {
			delete(s.arenaQueue, id)
		}
	}
}

func (s *Server) cancelArenaQueue(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	entry := s.authorizedQueue(r)
	if entry == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "queue entry not found")
		return
	}
	if entry.match != nil {
		s.mu.Unlock()
		writeError(w, http.StatusConflict, "match already started")
		return
	}
	delete(s.arenaQueue, entry.id)
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// authorizedQueue is called with s.mu held.
func (s *Server) authorizedQueue(r *http.Request) *arenaQueueEntry {
	entry := s.arenaQueue[strings.ToUpper(r.PathValue("id"))]
	if entry == nil || r.Header.Get("Authorization") != "Bearer "+entry.token {
		return nil
	}
	return entry
}

// nftSpecies is the fighter an NFT battles as: its set and card number looked
// up in the card catalog, or, for any other card, the Pokémon its printed name
// identifies ("Dark Charizard" → charizard, "Galarian Rapidash V" →
// rapidash-galar). "" if neither matches.
func nftSpecies(card collectibles.Card) string {
	if key, ok := pokedex.SpeciesForCard(card.Attribute("Set"), card.Attribute("Card Number")); ok {
		return key
	}
	key, _ := pokedex.SpeciesForCardName(card.Attribute("Card Name"))
	return key
}
