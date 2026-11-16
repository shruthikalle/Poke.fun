package battle

import (
	"encoding/json"
	"errors"
	"reflect"
)

// Snapshot is private storage data, never an HTTP view. Player tokens are
// explicit because their normal JSON representation deliberately omits them.
type Snapshot struct {
	Version int       `json:"version"`
	State   Match     `json:"state"`
	Tokens  [2]string `json:"tokens"`
}

func (m *Match) Snapshot() Snapshot {
	s := Snapshot{Version: 1, State: *m}
	for i, p := range m.Players {
		if p != nil {
			s.Tokens[i] = p.Token
		}
	}
	// Also detach card slices, players and history from the live engine.
	data, _ := json.Marshal(s)
	var copy Snapshot
	_ = json.Unmarshal(data, &copy)
	return copy
}

func Restore(s Snapshot) (*Match, error) {
	invalid := errors.New("invalid duel snapshot")
	if s.Version != 1 || s.State.ID == "" || s.State.Players[0] == nil || s.State.Turn < 1 || s.State.Turn != len(s.State.History)+1 || s.State.RulesVersion != RulesVersion || s.State.CatalogVersion != CatalogVersion {
		return nil, invalid
	}
	if w := s.State.Winner; w != "" && w != "player1" && w != "player2" && w != "draw" {
		return nil, invalid
	}
	for i, p := range s.State.Players {
		if p == nil {
			if s.Tokens[i] != "" || s.State.Pending[i] != "" {
				return nil, invalid
			}
			continue
		}
		card, ok := FindCard(p.Card.ID)
		if !ok || !reflect.DeepEqual(card, p.Card) || p.Name == "" || s.Tokens[i] == "" || p.HP < 0 || p.HP > card.MaxHP || p.Energy < 0 {
			return nil, invalid
		}
		if attack := s.State.Pending[i]; attack != "" {
			if _, ok := availableAttack(p, attack); !ok || s.State.Players[1] == nil || s.State.Winner != "" {
				return nil, invalid
			}
		}
	}
	if s.State.Pending[0] != "" && s.State.Pending[1] != "" || s.Tokens[0] == s.Tokens[1] {
		return nil, invalid
	}
	playing := s.State.Players[1] != nil && s.State.Winner == ""
	if playing == s.State.Deadline.IsZero() {
		return nil, invalid
	}
	// Round-trip to ensure the restored engine cannot modify the caller's data.
	data, err := json.Marshal(s)
	if err != nil {
		return nil, invalid
	}
	var copy Snapshot
	if json.Unmarshal(data, &copy) != nil {
		return nil, invalid
	}
	m := &copy.State
	for i, p := range m.Players {
		if p != nil {
			p.Token = copy.Tokens[i]
		}
	}
	return m, nil
}
