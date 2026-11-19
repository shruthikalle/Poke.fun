package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/gamestore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/market"
	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
	"github.com/shruthikalle/Poke.fun/services/api/internal/server"
	"github.com/shruthikalle/Poke.fun/services/api/internal/solana"
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
	// Battle-eligible collections: the original test collection plus the marketplace's minted one.
	battleCollections := strings.TrimSpace(os.Getenv("DEVNET_TEST_COLLECTION_ID") + " " + os.Getenv("MARKET_MINT_COLLECTION"))
	if battleCollections != "" {
		cfg.Collectibles = collectibles.NewReader(env("DEVNET_RPC_URL", "https://api.devnet.solana.com"), battleCollections)
		log.Printf("Metaplex Core NFT reader enabled for collections %s", battleCollections)
	}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	// Marketplace trades are wallet-signed; an optional devnet minter handles onboarding.
	if programID := os.Getenv("MARKET_PROGRAM_ID"); programID != "" {
		rpcURL := env("MARKET_RPC_URL", env("DEVNET_RPC_URL", "https://api.devnet.solana.com"))
		minter, err := loadMinter(rpcURL)
		if err != nil {
			log.Fatalf("market minter: %v", err)
		}
		svc, err := market.New(market.Options{
			RPCURL:    rpcURL,
			ProgramID: programID,
			StorePath: env("MARKET_STORE_PATH", "data/market.json"),
			PriceURL:  env("SOL_PRICE_URL", "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true"),
			Minter:    minter,
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

// loadMinter enables free devnet card mints and the SOL faucet when
// MARKET_MINTER_KEYPAIR (inline solana-keygen JSON or a file path) and
// MARKET_MINT_COLLECTION (a Core collection that keypair controls) are set.
func loadMinter(rpcURL string) (*market.Minter, error) {
	secret, collection := os.Getenv("MARKET_MINTER_KEYPAIR"), os.Getenv("MARKET_MINT_COLLECTION")
	if secret == "" && collection == "" {
		return nil, nil
	}
	if secret == "" || collection == "" {
		return nil, fmt.Errorf("set both MARKET_MINTER_KEYPAIR and MARKET_MINT_COLLECTION")
	}
	wallet, err := solana.LoadKeypair(secret)
	if err != nil {
		return nil, err
	}
	collectionKey, err := solana.ParseKey(collection)
	if err != nil {
		return nil, err
	}
	sol, err := strconv.ParseFloat(env("MARKET_FAUCET_SOL", "0.25"), 64)
	if err != nil || math.IsNaN(sol) || math.IsInf(sol, 0) || sol < 0 || sol > 2 {
		return nil, fmt.Errorf("MARKET_FAUCET_SOL must be between 0 and 2")
	}
	lamports := uint64(sol * 1e9)
	rpcClient := solana.NewClient(rpcURL)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := rpcClient.CheckDevnet(ctx); err != nil {
		return nil, err
	}
	log.Printf("Devnet card minter %s enabled for collection %s (faucet %.3f SOL)", wallet.Public, collection, sol)
	return &market.Minter{
		Wallet: wallet, Collection: collectionKey, RPC: rpcClient, Deck: market.DefaultDeck(),
		FaucetLamports: lamports, FaucetThreshold: lamports, Reserve: 50_000_000,
	}, nil
}
