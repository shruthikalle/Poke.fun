// Package playerstore keeps local-server demo ranks. Names are public identifiers,
// not authenticated accounts. A single server owns each JSON file.
package playerstore

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

type History struct {
	At       int64  `json:"at"`
	Opponent string `json:"opponent"`
	Result   string `json:"result"`
	Delta    int    `json:"delta"`
	MatchID  string `json:"matchId,omitempty"`
}

type RankInfo struct {
	Rating  int       `json:"rating"`
	Tier    string    `json:"tier"`
	Wins    int       `json:"wins"`
	Losses  int       `json:"losses"`
	Draws   int       `json:"draws"`
	History []History `json:"history"`
}

type Player struct {
	Name string `json:"name"`
	RankInfo
}

type result struct {
	P1     string `json:"p1"`
	P2     string `json:"p2"`
	Winner string `json:"winner"`
}

type data struct {
	Players map[string]Player `json:"players"`
	Results map[string]result `json:"results"`
}

type Store struct {
	mu   sync.Mutex
	path string
	data data
}

// Open uses memory only when path is empty. Corrupt/unreadable files fail closed.
func Open(path string) (*Store, error) {
	s := &Store{path: path, data: data{Players: map[string]Player{}, Results: map[string]result{}}}
	if path == "" {
		return s, nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var loaded data
	if err := json.Unmarshal(b, &loaded); err != nil {
		return nil, err
	}
	if loaded.Players == nil || loaded.Results == nil {
		return nil, errors.New("invalid player store")
	}
	s.data = loaded
	return s, nil
}

func ValidName(name string) bool {
	name = strings.TrimSpace(name)
	return len(name) > 0 && len(name) <= 24 && !strings.ContainsFunc(name, unicode.IsControl)
}

func Tier(rating int) string {
	switch {
	case rating >= 1800:
		return "Master"
	case rating >= 1650:
		return "Platinum"
	case rating >= 1500:
		return "Gold"
	case rating >= 1350:
		return "Silver"
	default:
		return "Bronze"
	}
}

func (s *Store) player(name string) Player {
	p, ok := s.data.Players[strings.ToLower(strings.TrimSpace(name))]
	if !ok {
		p = Player{Name: strings.TrimSpace(name), RankInfo: RankInfo{Rating: 1200, History: []History{}}}
	}
	p.Tier = Tier(p.Rating)
	p.History = append([]History{}, p.History...)
	return p
}

func (s *Store) Rank(name string) RankInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.player(name).RankInfo
}

func (s *Store) Leaderboard() []Player {
	s.mu.Lock()
	defer s.mu.Unlock()
	players := make([]Player, 0, len(s.data.Players))
	for _, p := range s.data.Players {
		players = append(players, s.player(p.Name))
	}
	sort.Slice(players, func(i, j int) bool {
		if players[i].Rating != players[j].Rating {
			return players[i].Rating > players[j].Rating
		}
		return players[i].Name < players[j].Name
	})
	return players
}

// Record is a server-internal operation. Repeating the same result is harmless,
// including after restart; reusing its ID with a different outcome is an error.
// There is deliberately no HTTP endpoint for client-submitted wins or ratings.
func (s *Store) Record(id, p1, p2, winner string) error {
	p1, p2 = strings.TrimSpace(p1), strings.TrimSpace(p2)
	a, b := strings.ToLower(p1), strings.ToLower(p2)
	if winner == "player1" {
		winner = "p1"
	}
	if winner == "player2" {
		winner = "p2"
	}
	if id == "" || !ValidName(p1) || !ValidName(p2) || a == b || (winner != "p1" && winner != "p2" && winner != "draw") {
		return errors.New("invalid ranked result")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := result{a, b, winner}
	if prev, ok := s.data.Results[id]; ok {
		if prev != r {
			return errors.New("conflicting ranked result")
		}
		return nil
	}
	one, two := s.player(p1), s.player(p2)
	score := 0.5
	if winner == "p1" {
		score = 1
	}
	if winner == "p2" {
		score = 0
	}
	expected := 1 / (1 + math.Pow(10, float64(two.Rating-one.Rating)/400))
	delta := int(math.Round(32 * (score - expected)))
	now := time.Now().UnixMilli()
	update := func(p *Player, opponent string, score float64, delta int) {
		outcome := "draw"
		if score == 1 {
			p.Wins++
			outcome = "win"
		} else if score == 0 {
			p.Losses++
			outcome = "loss"
		} else {
			p.Draws++
		}
		p.Rating += delta
		p.Tier = Tier(p.Rating)
		p.History = append([]History{{At: now, Opponent: opponent, Result: outcome, Delta: delta, MatchID: id}}, p.History...)
		if len(p.History) > 20 {
			p.History = p.History[:20]
		}
	}
	update(&one, two.Name, score, delta)
	update(&two, one.Name, 1-score, -delta)
	// Copy before saving so a failed write leaves the old in-memory state intact.
	next := data{Players: make(map[string]Player, len(s.data.Players)+2), Results: make(map[string]result, len(s.data.Results)+1)}
	for k, v := range s.data.Players {
		next.Players[k] = v
	}
	for k, v := range s.data.Results {
		next.Results[k] = v
	}
	next.Players[a], next.Players[b], next.Results[id] = one, two, r
	if err := s.save(next); err != nil {
		return err
	}
	s.data = next
	return nil
}

func (s *Store) save(next data) error {
	if s.path == "" {
		return nil
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".players-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = json.NewEncoder(f).Encode(next); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), s.path)
}
