package server

import (
	"fmt"
	"math"
	"net/http"
	"strings"
)

// seatTerms is one seat's entry eligibility, fixed when the seat is created:
// the verified NFT behind each creature in team order, "" for a rental. Asset
// IDs are kept server-side and appear only in the sealed result.
type seatTerms struct {
	Assets []string `json:"assets"`
}

func (t seatTerms) verifiedAssets() []string {
	out := []string{}
	for _, id := range t.Assets {
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}

// matchTerms are what both seats agreed to when they paired. They are sealed
// into the result so a settlement consumer never has to re-derive the entry
// amount or which cards were verified.
type matchTerms struct {
	EntryCents int          `json:"entryCents"`
	Seats      [2]seatTerms `json:"seats"`
}

func arenaTermsKey(id string) string { return "arena:" + id }
func teamTermsKey(id string) string  { return "team:" + id }

func entryCents(dollars float64) int { return int(math.Round(dollars * 100)) }

// setTermsLocked records a match's terms. s.mu must be held.
func (s *Server) setTermsLocked(key string, terms matchTerms) {
	if s.terms == nil {
		s.terms = map[string]matchTerms{}
	}
	s.terms[key] = terms
}

// activeAssetsLocked lists every verified NFT behind a waiting search or an
// unfinished match. s.mu must be held.
func (s *Server) activeAssetsLocked() map[string]bool {
	active := map[string]bool{}
	mark := func(seat seatTerms) {
		for _, id := range seat.verifiedAssets() {
			active[id] = true
		}
	}
	for _, entry := range s.arenaQueue {
		if entry.match == nil {
			mark(entry.seat)
		}
	}
	for _, entry := range s.waiting {
		mark(entry.seat)
	}
	for key, terms := range s.terms {
		if !s.termsActiveLocked(key) {
			continue
		}
		mark(terms.Seats[0])
		mark(terms.Seats[1])
	}
	return active
}

func (s *Server) termsActiveLocked(key string) bool {
	kind, id, _ := strings.Cut(key, ":")
	switch kind {
	case "arena":
		game := s.arenas[id]
		return game != nil && game.Winner == ""
	case "team":
		b := s.battles[id]
		return b != nil && !b.Over()
	}
	return false
}

// claimAssetsLocked rejects a seat whose verified card already backs another
// search or unfinished match, so one NFT cannot fight two battles at once.
// s.mu must be held.
func (s *Server) claimAssetsLocked(w http.ResponseWriter, seat seatTerms) bool {
	active := s.activeAssetsLocked()
	for _, id := range seat.verifiedAssets() {
		if active[id] {
			writeError(w, http.StatusConflict, "this card is already in a search or an unfinished match")
			return false
		}
	}
	return true
}

// participantAssets is a seat's assets for a sealed result: nil when every
// creature was a rental, otherwise aligned with the seat's species.
func (t seatTerms) participantAssets() []string {
	if len(t.verifiedAssets()) == 0 {
		return nil
	}
	return append([]string(nil), t.Assets...)
}

// validateTerms checks a restored terms record against the restored team sizes.
func validateTerms(key string, terms matchTerms, sizes [2]int, ok bool) error {
	if !ok || terms.EntryCents < 0 {
		return fmt.Errorf("terms %q do not match a game", key)
	}
	for i, seat := range terms.Seats {
		if len(seat.Assets) != sizes[i] {
			return fmt.Errorf("terms %q seat %d has the wrong team size", key, i+1)
		}
	}
	return nil
}
