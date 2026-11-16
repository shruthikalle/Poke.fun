package server

import (
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
)

type gameSnapshot struct {
	Version    int                            `json:"version"`
	Matches    map[string]battle.Snapshot     `json:"matches"`
	Battles    map[string]livebattle.Snapshot `json:"battles"`
	Arenas     map[string]arena.Snapshot      `json:"arenas"`
	Queue      map[string]queueSnapshot       `json:"queue"`
	Waiting    []string                       `json:"waiting"`
	ArenaQueue map[string]arenaQueueSnapshot  `json:"arenaQueue"`
	Terms      map[string]matchTerms          `json:"terms,omitempty"` // absent in older checkpoints
}

type queueSnapshot struct {
	Ticket  string       `json:"ticket"`
	Request queueRequest `json:"request"`
	Created time.Time    `json:"created"`
	Match   *queueMatch  `json:"match"`
	Seat    seatTerms    `json:"seat"`
}

type arenaQueueSnapshot struct {
	ID          string        `json:"id"`
	Token       string        `json:"token"`
	PlayerToken string        `json:"playerToken"`
	Name        string        `json:"name"`
	CardID      string        `json:"cardId"`
	Tier        int           `json:"tier"`
	Rating      int           `json:"rating"`
	EntryCents  int           `json:"entryCents"`
	Created     time.Time     `json:"created"`
	LastSeen    time.Time     `json:"lastSeen"`
	Match       *arenaSession `json:"match"`
	Opponent    string        `json:"opponent"`
	Seat        seatTerms     `json:"seat"`
}

func (s *Server) snapshotLocked() gameSnapshot {
	out := gameSnapshot{Version: 1, Matches: map[string]battle.Snapshot{},
		Battles: map[string]livebattle.Snapshot{}, Arenas: map[string]arena.Snapshot{},
		Queue: map[string]queueSnapshot{}, Waiting: []string{}, ArenaQueue: map[string]arenaQueueSnapshot{},
		Terms: map[string]matchTerms{}}
	for key, terms := range s.terms {
		out.Terms[key] = terms
	}
	for id, match := range s.matches {
		out.Matches[id] = match.Snapshot()
	}
	for id, b := range s.battles {
		out.Battles[id] = b.Snapshot()
	}
	for id, game := range s.arenas {
		out.Arenas[id] = game.Snapshot()
	}
	for id, entry := range s.queue {
		out.Queue[id] = queueSnapshot{Ticket: entry.ticket, Request: entry.req, Created: entry.created, Match: entry.match, Seat: entry.seat}
	}
	for _, entry := range s.waiting {
		out.Waiting = append(out.Waiting, entry.ticket)
	}
	for id, q := range s.arenaQueue {
		out.ArenaQueue[id] = arenaQueueSnapshot{ID: q.id, Token: q.token, PlayerToken: q.playerToken,
			Name: q.name, CardID: q.cardID, Tier: q.tier, Rating: q.rating, EntryCents: q.entryCents,
			Created: q.created, LastSeen: q.lastSeen, Match: q.match, Opponent: q.opponent, Seat: q.seat}
	}
	return out
}
