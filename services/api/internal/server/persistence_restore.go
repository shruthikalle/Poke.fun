package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
)

func (s *Server) restoreLocked(data []byte) error {
	invalid := errors.New("invalid game checkpoint")
	var saved gameSnapshot
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&saved) != nil || decoder.Decode(new(any)) != io.EOF || saved.Version != 1 || saved.Matches == nil || saved.Battles == nil || saved.Arenas == nil || saved.Queue == nil || saved.ArenaQueue == nil || saved.Waiting == nil {
		return invalid
	}
	matches := map[string]*battle.Match{}
	battles := map[string]*livebattle.Battle{}
	arenas := map[string]*arena.Game{}
	for id, snap := range saved.Matches {
		match, err := battle.Restore(snap)
		if err != nil || match.ID != id {
			return invalid
		}
		matches[id] = match
	}
	for id, snap := range saved.Battles {
		b, err := livebattle.Restore(snap)
		if err != nil || b.ID != id || b.SideFor(snap.Tokens["p1"]) != "p1" || b.Mode() == livebattle.ModePvP && b.SideFor(snap.Tokens["p2"]) != "p2" {
			return invalid
		}
		battles[id] = b
	}
	for id, snap := range saved.Arenas {
		game, err := arena.Restore(snap)
		if err != nil || game.ID != id {
			return invalid
		}
		arenas[id] = game
	}
	queue := map[string]*queueEntry{}
	waiting := []*queueEntry{}
	now := time.Now()
	// Searches get a fresh lease on startup so a server outage does not remove
	// existing client tickets before those clients have a chance to reconnect.
	for ticket, snap := range saved.Queue {
		if snap.Ticket == "" || snap.Ticket != ticket || snap.Created.IsZero() || snap.Request.validate() != nil {
			return invalid
		}
		if m := snap.Match; m != nil {
			b := battles[m.ID]
			if b == nil || m.Side != "p1" && m.Side != "p2" || b.SideFor(m.Token) != m.Side {
				return invalid
			}
		}
		if snap.Seat.Assets == nil {
			snap.Seat.Assets = make([]string, len(snap.Request.Team)) // older checkpoint: rentals
		}
		if len(snap.Seat.Assets) != len(snap.Request.Team) {
			return invalid
		}
		queue[ticket] = &queueEntry{ticket: ticket, req: snap.Request, seat: snap.Seat, created: now, match: snap.Match}
	}
	seen := map[string]bool{}
	for _, ticket := range saved.Waiting {
		entry := queue[ticket]
		if entry == nil || entry.match != nil || seen[ticket] {
			return invalid
		}
		seen[ticket] = true
		waiting = append(waiting, entry)
	}
	for ticket, entry := range queue {
		if entry.match == nil && !seen[ticket] {
			return invalid
		}
	}
	arenaQueue := map[string]*arenaQueueEntry{}
	for id, snap := range saved.ArenaQueue {
		card, ok := arena.FindCard(snap.CardID)
		if !ok || id == "" || id != snap.ID || snap.Token == "" || snap.PlayerToken == "" || !validName(snap.Name) || snap.Created.IsZero() || snap.LastSeen.IsZero() || snap.Tier != card.Tier || snap.Rating < 0 || snap.Rating > 5000 || snap.EntryCents < 0 || snap.EntryCents > 10000 {
			return invalid
		}
		if m := snap.Match; m != nil {
			game := arenas[m.ID]
			if game == nil || m.Token != snap.PlayerToken || game.PlayerIndex(m.Token) < 0 || m.EntryCents != snap.EntryCents {
				return invalid
			}
		}
		arenaQueue[id] = &arenaQueueEntry{id: id, token: snap.Token, playerToken: snap.PlayerToken,
			name: snap.Name, cardID: snap.CardID, tier: snap.Tier, rating: snap.Rating,
			entryCents: snap.EntryCents, created: snap.Created, lastSeen: now,
			match: snap.Match, opponent: snap.Opponent, seat: snap.Seat}
		if snap.Seat.Assets == nil {
			arenaQueue[id].seat.Assets = []string{""} // older checkpoint: rental
		}
		if len(arenaQueue[id].seat.Assets) != 1 {
			return invalid
		}
	}
	terms, err := restoreTerms(saved.Terms, arenas, battles)
	if err != nil {
		return err
	}
	// Publish only after every engine and cross-reference has passed validation.
	s.matches, s.battles, s.arenas = matches, battles, arenas
	s.queue, s.waiting, s.arenaQueue = queue, waiting, arenaQueue
	s.terms = terms
	return nil
}

// restoreTerms checks each saved terms record against its restored game.
func restoreTerms(saved map[string]matchTerms, arenas map[string]*arena.Game, battles map[string]*livebattle.Battle) (map[string]matchTerms, error) {
	out := map[string]matchTerms{}
	for key, terms := range saved {
		var sizes [2]int
		kind, id, _ := strings.Cut(key, ":")
		ok := false
		switch kind {
		case "arena":
			if game := arenas[id]; game != nil {
				ok = true
				for i, fighter := range game.Fighters {
					if fighter != nil {
						sizes[i] = 1
					}
				}
			}
		case "team":
			if b := battles[id]; b != nil {
				ok = true
				p1, p2 := b.TeamSizes()
				sizes = [2]int{p1, p2}
			}
		}
		if err := validateTerms(key, terms, sizes, ok); err != nil {
			return nil, err
		}
		out[key] = terms
	}
	return out, nil
}
