package server

import (
	"compress/gzip"
	"encoding/json"
	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"net/http"
	"strings"
)

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
