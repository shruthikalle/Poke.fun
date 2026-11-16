package server

import (
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
	seat                   seatTerms // the verified NFT, if any, fixed at entry
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
		Rental     *bool  `json:"rental,omitempty"`
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
	if !s.verifyArenaAsset(w, r, req.CardID, req.AssetID, req.Wallet) {
		return
	}

	req.Rating = s.playerRating(req.Name)
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
	seat := seatTerms{Assets: []string{req.AssetID}}
	if !s.claimAssetsLocked(w, seat) {
		s.mu.Unlock()
		return
	}
	entry := &arenaQueueEntry{id: id, token: token, playerToken: playerToken, name: strings.TrimSpace(req.Name), cardID: req.CardID, tier: fighter.Tier, rating: req.Rating, entryCents: req.EntryCents, created: now, lastSeen: now, seat: seat}
	best := s.arenaOpponentLocked(entry, now)
	s.arenaQueue[id] = entry
	if best == nil {
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, entry.response(true))
		return
	}
	matchID, err := s.pairArenaLocked(best, entry)
	if err != nil {
		delete(s.arenaQueue, id)
		s.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not create match")
		return
	}
	response := entry.response(true)
	s.mu.Unlock()
	go s.runArena(matchID)
	writeJSON(w, http.StatusCreated, response)
}

// arenaOpponentLocked picks a waiting opponent for entry: same entry amount and
// power tier, a different name, within the rating band, then the closest
// rating, breaking ties by waiting time. s.mu must be held.
func (s *Server) arenaOpponentLocked(entry *arenaQueueEntry, now time.Time) *arenaQueueEntry {
	var best *arenaQueueEntry
	for _, candidate := range s.arenaQueue {
		if candidate == entry || candidate.match != nil || candidate.entryCents != entry.entryCents || candidate.tier != entry.tier ||
			strings.EqualFold(candidate.name, entry.name) ||
			!withinRatingBand(candidate.rating, entry.rating, now.Sub(candidate.created), now.Sub(entry.created)) {
			continue
		}
		distance := abs(candidate.rating - entry.rating)
		if best == nil || distance < abs(best.rating-entry.rating) ||
			(distance == abs(best.rating-entry.rating) && candidate.created.Before(best.created)) {
			best = candidate
		}
	}
	return best
}

// pairArenaLocked starts an arena between a waiting player (seat 1) and entry
// (seat 2) and records the match terms. The caller starts the arena loop after
// releasing s.mu.
func (s *Server) pairArenaLocked(first, second *arenaQueueEntry) (string, error) {
	var matchID string
	for {
		id, err := randomCode()
		if err != nil {
			return "", err
		}
		if s.arenas[id] == nil {
			matchID = id
			break
		}
	}
	game, err := arena.New(matchID, first.name, first.cardID, first.playerToken)
	if err == nil {
		err = game.Join(second.name, second.cardID, second.playerToken)
	}
	if err != nil {
		return "", err
	}
	s.arenas[matchID] = game
	s.setTermsLocked(arenaTermsKey(matchID), matchTerms{EntryCents: first.entryCents, Seats: [2]seatTerms{first.seat, second.seat}})
	first.match = &arenaSession{ID: matchID, Token: first.playerToken, EntryCents: first.entryCents}
	first.opponent = second.name
	second.match = &arenaSession{ID: matchID, Token: second.playerToken, EntryCents: second.entryCents}
	second.opponent = first.name
	return matchID, nil
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
	now := time.Now()
	entry.lastSeen = now
	// The band widens while searching, so a poll may pair two waiting players.
	matchID := ""
	if entry.match == nil {
		s.pruneWaitingQueue(now)
		if waiter := s.arenaOpponentLocked(entry, now); waiter != nil {
			id, err := s.pairArenaLocked(waiter, entry)
			if err != nil {
				s.mu.Unlock()
				writeError(w, http.StatusInternalServerError, "could not create match")
				return
			}
			matchID = id
		}
	}
	response := entry.response(false)
	s.mu.Unlock()
	if matchID != "" {
		go s.runArena(matchID)
	}
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
