package server

import (
	"context"
	"net/http"
	"sync"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
)

type Server struct {
	mu              sync.Mutex
	matches         map[string]*battle.Match
	battles         map[string]*livebattle.Battle
	queue           map[string]*queueEntry
	waiting         []*queueEntry
	arenas          map[string]*arena.Game
	peers           map[string]map[*arenaPeer]struct{}
	arenaQueue      map[string]*arenaQueueEntry
	terms           map[string]matchTerms // entry terms by arena:/team: match key
	origin          string
	collectibles    collectibleReader
	players         *playerstore.Store
	playerInit      sync.Once
	community       *communityState
	games           GameStore
	results         *resultstore.Store
	resultInit      sync.Once
	resultErr       error
	persistenceErr  error
	persistenceGate *sync.Mutex
	closed          bool
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
	players, _ := playerstore.Open("")
	return NewWithPlayerStore(origin, reader, players)
}

// NewWithPlayerStore lets main supply a persistent store; ordinary constructors
// keep tests and isolated demo servers in memory.
func NewWithPlayerStore(origin string, reader collectibleReader, players *playerstore.Store) http.Handler {
	handler, err := NewWithConfig(Config{Origin: origin, Collectibles: reader, Players: players})
	if err != nil {
		panic(err)
	} // memory-only construction cannot fail
	return handler
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/cards", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, battle.Cards())
	})
	mux.HandleFunc("POST /api/matches", s.createMatch)
	mux.HandleFunc("GET /api/ranks", s.ranks)
	mux.HandleFunc("GET /api/leaderboard", s.leaderboard)
	mux.HandleFunc("GET /api/community", s.getCommunity)
	mux.HandleFunc("POST /api/community/presence", s.heartbeat)
	mux.HandleFunc("DELETE /api/community/presence", s.leaveCommunity)
	mux.HandleFunc("GET /api/community/rooms/{room}/messages", s.roomMessages)
	mux.HandleFunc("POST /api/community/rooms/{room}/messages", s.sendRoomMessage)
	mux.HandleFunc("POST /api/matches/{id}/join", s.joinMatch)
	mux.HandleFunc("GET /api/matches/{id}", s.getMatch)
	mux.HandleFunc("POST /api/matches/{id}/attacks", s.submitAttack)
	// Team battles (live.go): single-player vs AI, or two players via the queue.
	mux.HandleFunc("POST /api/battles", s.createBattle)
	mux.HandleFunc("GET /api/species/{key}", s.species)
	mux.HandleFunc("GET /api/battles/{id}/events", s.battleEvents)
	mux.HandleFunc("POST /api/battles/{id}/team", s.battleTeam)
	mux.HandleFunc("POST /api/battles/{id}/choice", s.battleChoice)
	mux.HandleFunc("POST /api/battles/{id}/timer", s.battleTimer)
	mux.HandleFunc("POST /api/battles/{id}/chat", s.battleChat)
	mux.HandleFunc("POST /api/battles/{id}/rematch", s.battleRematch)
	mux.HandleFunc("POST /api/battles/{id}/forfeit", s.battleForfeit)
	// Two-player matchmaking (matchmaking.go).
	mux.HandleFunc("POST /api/queue", s.enqueue)
	mux.HandleFunc("GET /api/queue/{ticket}", s.pollQueue)
	mux.HandleFunc("DELETE /api/queue/{ticket}", s.cancelQueue)
	mux.HandleFunc("GET /api/arena-cards", arenaCards)
	mux.HandleFunc("GET /api/collectibles/{id}", s.getCollectible)
	mux.HandleFunc("POST /api/arenas", s.createArena)
	mux.HandleFunc("POST /api/arenas/{id}/join", s.joinArena)
	mux.HandleFunc("POST /api/arenas/{id}/forfeit", s.arenaForfeit)
	mux.HandleFunc("GET /api/arenas/{id}", s.getArena)
	mux.HandleFunc("GET /api/arenas/{id}/ws", s.arenaSocket)
	mux.HandleFunc("POST /api/arena-queue", s.enqueueArena)
	mux.HandleFunc("GET /api/arena-queue/{id}", s.getArenaQueue)
	mux.HandleFunc("DELETE /api/arena-queue/{id}", s.cancelArenaQueue)
	s.registerResultRoutes(mux)
	return s.withCORS(s.durableResponses(mux))
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
