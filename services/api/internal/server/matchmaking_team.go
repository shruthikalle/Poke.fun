package server

import (
	"fmt"
	"math"

	"github.com/shruthikalle/Poke.fun/services/api/internal/livebattle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

// queuePick preserves the card-pick wire shape. Only species is a combat
// selection; all combat and display metadata is resolved from the server dex.
type queuePick struct {
	Key       string    `json:"key"`
	Species   string    `json:"species"`
	Label     string    `json:"label"`
	Image     *string   `json:"image"`
	Grade     *string   `json:"grade"`
	Level     int       `json:"level"`
	Tier      int       `json:"tier"`
	Rental    bool      `json:"rental"`
	AssetID   string    `json:"assetId,omitempty"`
	Wallet    string    `json:"walletAddress,omitempty"`
	ArtWindow artWindow `json:"artWindow"`
}
type artWindow struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func (q *queueRequest) validate() error {
	size := 1
	if q.Format == "squad" {
		size = 3
	} else if q.Format != "champion" {
		return fmt.Errorf("format must be champion or squad")
	}
	if !validName(q.Trainer.Name) {
		return fmt.Errorf("name must be 1–24 characters")
	}
	if q.Entry < 0 || math.IsNaN(q.Entry) || math.IsInf(q.Entry, 0) || math.Abs(q.Entry*100-math.Round(q.Entry*100)) > 0.000001 {
		return fmt.Errorf("entry must be a nonnegative amount in whole cents")
	}
	if len(q.Team) != size {
		return fmt.Errorf("%s requires exactly %d creatures", q.Format, size)
	}
	seen := map[string]bool{}
	tier := 0
	for i, p := range q.Team {
		s, ok := pokedex.Lookup(p.Species)
		if !ok {
			return fmt.Errorf("unknown species %q", p.Species)
		}
		if seen[s.Species] {
			return fmt.Errorf("species clause: duplicate %s", s.Name)
		}
		seen[s.Species] = true
		if p.Level != 0 && p.Level != livebattle.BattleLevel {
			return fmt.Errorf("creatures must be level %d", livebattle.BattleLevel)
		}
		if s.Tier > tier {
			tier = s.Tier
		}
		// Keep collectible presentation metadata, but never trust tier/level/name.
		q.Team[i].Level = livebattle.BattleLevel
		q.Team[i].Tier = s.Tier
		q.Team[i].Label = s.Name
		if q.Team[i].Key == "" {
			q.Team[i].Key = s.Key
		}
	}
	if q.Tier != tier {
		return fmt.Errorf("team tier must be %d (highest species tier)", tier)
	}
	return nil
}

func (q queueRequest) creatures(side string) []livebattle.Creature {
	team := make([]livebattle.Creature, len(q.Team))
	for i, p := range q.Team {
		team[i] = livebattle.Creature{SpriteID: p.Species, CardArt: p.Image}
	}
	return team // New resolves these selections into canonical creatures.
}
