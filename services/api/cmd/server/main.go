package main

import (
	"log"
	"net/http"
	"os"

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
	log.Printf("API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, server.New(origin)))
}
