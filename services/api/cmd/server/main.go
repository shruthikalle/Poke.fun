package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/gamestore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/market"
	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/server"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func main() {
	addr := env("API_ADDR", ":8080")
	origin := env("WEB_ORIGIN", "http://localhost:3000")
	players, err := playerstore.Open(env("PLAYER_STORE_PATH", "data/players.json"))
	if err != nil {
		log.Fatalf("open player store: %v", err)
	}
	// Matches, queues and their entry terms survive restarts in one checkpoint.
	games, err := gamestore.Open(env("GAME_STORE_PATH", "data/games.json"))
	if err != nil {
		log.Fatalf("open game store: %v", err)
	}
	// Sealed results are signed with a persistent referee key so receipts
	// issued before a restart still verify against GET /api/referee.
	results, err := resultstore.Open(env("RESULT_STORE_PATH", "data/results.json"), env("REFEREE_KEY_PATH", "data/referee.key"))
	if err != nil {
		log.Fatalf("open result store: %v", err)
	}
	cfg := server.Config{Origin: origin, Players: players, Games: games, Results: results}
	if collection := os.Getenv("DEVNET_TEST_COLLECTION_ID"); collection != "" {
		cfg.Collectibles = collectibles.NewReader(env("DEVNET_RPC_URL", "https://api.devnet.solana.com"), collection)
		log.Printf("Metaplex Core NFT reader enabled for collection %s", collection)
	}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	// The marketplace index is read-only: it never holds keys or signs.
	if programID := os.Getenv("MARKET_PROGRAM_ID"); programID != "" {
		svc, err := market.New(market.Options{
			RPCURL:    env("MARKET_RPC_URL", env("DEVNET_RPC_URL", "https://api.devnet.solana.com")),
			ProgramID: programID,
			StorePath: env("MARKET_STORE_PATH", "data/market.json"),
			PriceURL:  env("SOL_PRICE_URL", "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true"),
		})
		if err != nil {
			log.Fatalf("open market index: %v", err)
		}
		go svc.Run(stop)
		cfg.Market = svc.Handler()
		log.Printf("Marketplace index enabled for program %s", programID)
	}
	handler, err := server.NewWithConfig(cfg)
	if err != nil {
		log.Fatalf("restore games: %v", err)
	}

	httpServer := &http.Server{Addr: addr, Handler: handler}
	go func() {
		log.Printf("API listening on %s", addr)
		if err := httpServer.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-stop.Done()
	shutdown, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	if err := httpServer.Shutdown(shutdown); err != nil {
		log.Printf("shutdown: %v", err)
	}
	if err := handler.Close(); err != nil {
		log.Fatalf("final game checkpoint: %v", err)
	}
	log.Print("API stopped; games checkpointed")
}
