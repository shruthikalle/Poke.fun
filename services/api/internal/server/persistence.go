package server

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
)

// GameStore allows tests and deployments to inject checkpoint storage. A store
// belongs to one server at a time. Nil keeps the traditional in-memory server.
type GameStore interface {
	Load() (json.RawMessage, error)
	Save(json.RawMessage) error
}

type Config struct {
	Origin       string
	Collectibles collectibleReader
	Players      *playerstore.Store
	Games        GameStore
	Results      *resultstore.Store
	// Market serves /api/market (read-only marketplace index); nil disables it.
	Market http.Handler
}

// Handler owns the server lifecycle. Close quiesces HTTP mutations and flushes
// the final checkpoint. Call it after http.Server.Shutdown in production.
type Handler struct {
	http.Handler
	server *Server
	gate   sync.Mutex
}

func NewWithConfig(cfg Config) (*Handler, error) {
	if cfg.Players == nil {
		cfg.Players, _ = playerstore.Open("")
	}
	s := &Server{matches: map[string]*battle.Match{}, battles: map[string]*livebattle.Battle{},
		queue: map[string]*queueEntry{}, arenas: map[string]*arena.Game{},
		peers: map[string]map[*arenaPeer]struct{}{}, arenaQueue: map[string]*arenaQueueEntry{}, terms: map[string]matchTerms{},
		origin: cfg.Origin, collectibles: cfg.Collectibles, players: cfg.Players,
		games: cfg.Games, results: cfg.Results, community: newCommunity(), market: cfg.Market}
	if cfg.Games != nil {
		data, err := cfg.Games.Load()
		if err != nil {
			return nil, err
		}
		if len(data) > 0 {
			if err := s.restoreLocked(data); err != nil {
				return nil, err
			}
		}
		// Check write access before accepting games, including on a fresh path.
		if err := s.checkpointLocked(); err != nil {
			return nil, err
		}
	}
	h := &Handler{server: s}
	s.persistenceGate = &h.gate
	h.Handler = s.routes()
	// Restored live arenas restart their existing single loop. Inputs and peer
	// connections were reset by arena.Restore; no stored key press is replayed.
	for id, game := range s.arenas {
		if game.Fighters[1] != nil && game.Winner == "" {
			go s.runArena(id)
		}
	}
	return h, nil
}

func (h *Handler) Close() error {
	h.gate.Lock()
	defer h.gate.Unlock()
	s := h.server
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return s.checkpointLocked()
}

// checkpointLocked and checkpointArenaLocked must be called with s.mu held.
func (s *Server) checkpointLocked() error {
	if s.games == nil {
		return nil
	}
	data, err := json.Marshal(s.snapshotLocked())
	if err == nil {
		err = s.games.Save(data)
	}
	s.persistenceErr = err
	return err
}

// Arena simulation can lose at most the last second on an unclean process
// exit. HTTP mutations, final outcomes and graceful shutdown flush immediately.
// A failed checkpoint stops publication/advancement until a retry succeeds.
func (s *Server) checkpointArenaLocked(game *arena.Game) error {
	if s.games == nil || game.Winner == "" && game.Tick%20 != 0 && s.persistenceErr == nil {
		return nil
	}
	return s.checkpointLocked()
}
