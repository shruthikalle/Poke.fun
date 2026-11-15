// Package livebattle is the authoritative engine for the rich team battle shown
// at /battle. The web client builds creature teams from PokéAPI and sends them
// here; the server decides every move outcome, damage, faint and winner and
// returns the ordered events the client reducer already understands. It
// replaces the client-side MockBattleStream so the server is the referee.
package livebattle

import "github.com/shruthikalle/Poke.fun/services/api/internal/battle"

// Wire types mirror apps/web/lib/battle/types.ts so JSON round-trips exactly.

type Move struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Category string `json:"category"` // "physical" | "special"
	Power    int    `json:"power"`
	Accuracy int    `json:"accuracy"`
	PP       int    `json:"pp"`
	MaxPP    int    `json:"maxPp"`
}

type Sprites struct {
	Front       string `json:"front"`
	Back        string `json:"back"`
	FrontStatic string `json:"frontStatic"`
	BackStatic  string `json:"backStatic"`
}

type Stats struct {
	Atk int `json:"atk"`
	Def int `json:"def"`
	Spa int `json:"spa"`
	Spd int `json:"spd"`
}

type Creature struct {
	ID       string   `json:"id"`
	Species  string   `json:"species"`
	SpriteID string   `json:"spriteId"`
	Sprites  Sprites  `json:"sprites"`
	Speed    int      `json:"speed"`
	Stats    Stats    `json:"stats"`
	CardArt  *string  `json:"cardArt"`
	Level    int      `json:"level"`
	Gender   *string  `json:"gender"`
	Types    []string `json:"types"`
	HP       int      `json:"hp"`
	MaxHP    int      `json:"maxHp"`
	Moves    []Move   `json:"moves"`
	Fainted  bool     `json:"fainted"`
}

type Trainer struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

type SideState struct {
	Side        string      `json:"side"`
	Trainer     Trainer     `json:"trainer"`
	Team        []*Creature `json:"team"`
	ActiveIndex int         `json:"activeIndex"`
}

type Rule struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Format struct {
	Name  string `json:"name"`
	Rated bool   `json:"rated"`
	Rules []Rule `json:"rules"`
}

// Choice is a player action: a move or a switch.
type Choice struct {
	Kind      string `json:"kind"` // "move" | "switch"
	MoveIndex int    `json:"moveIndex"`
	TeamIndex int    `json:"teamIndex"`
}

// Event is one BattleEvent. Shapes vary by "type", so it is an open map that
// marshals to the discriminated union the client reducer switches on.
type Event map[string]any

// effectiveness multiplies the chart over each of the defender's types, matching
// apps/web/lib/battle/roster.ts.
func effectiveness(moveType string, defenderTypes []string) float64 {
	mult := 1.0
	for _, t := range defenderTypes {
		mult *= battle.TypeMultiplier(battle.Element(moveType), battle.Element(t))
	}
	return mult
}

func effectivenessLabel(mult float64) string {
	switch {
	case mult == 0:
		return "immune"
	case mult > 1:
		return "super"
	case mult < 1:
		return "resisted"
	default:
		return "normal"
	}
}

func contains(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}
