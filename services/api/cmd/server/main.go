package main

import (
	"log"
	"net/http"
	"os"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/server"
)

func main() {
	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	origin := os.Getenv("WEB_ORIGIN")
	if origin == "" {
		origin = "http://localhost:3000"
	}
	var handler http.Handler = server.New(origin)
	if collection := os.Getenv("DEVNET_TEST_COLLECTION_ID"); collection != "" {
		rpcURL := os.Getenv("DEVNET_RPC_URL")
		if rpcURL == "" {
			rpcURL = "https://api.devnet.solana.com"
		}
		handler = server.NewWithCollectibles(origin, collectibles.NewReader(rpcURL, collection))
		log.Printf("Metaplex Core NFT reader enabled for collection %s", collection)
	}
	log.Printf("API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}
