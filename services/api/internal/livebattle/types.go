// Package livebattle implements authoritative team combat using the embedded Pokédex.
package livebattle

import (
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

// Wire types mirror apps/web/lib/battle/types.ts so JSON round-trips exactly.

type Move struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Category string `json:"category"` // "physical" | "special" | "status"
	Power    int    `json:"power"`
	Accuracy int    `json:"accuracy"`
	PP       int    `json:"pp"`
	MaxPP    int    `json:"maxPp"`
	// Effect is the move's data-driven behaviour (nil for plain damage and Struggle).
	Effect *pokedex.Effect `json:"effect,omitempty"`
}

// Boosts are stat stages from -6 to +6; they reset when the creature switches out.
type Boosts struct {
	Atk int `json:"atk,omitempty"`
	Def int `json:"def,omitempty"`
	Spa int `json:"spa,omitempty"`
	Spd int `json:"spd,omitempty"`
	Spe int `json:"spe,omitempty"`
	Acc int `json:"acc,omitempty"`
	Eva int `json:"eva,omitempty"`
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
	// Status is "", "burn", "poison", "toxic", "paralysis", "sleep" or "freeze";
	// it persists through switching. StatusTurns counts sleep turns left, or the
	// bad-poison damage step. Confused is the confusion turns left.
	Status      string `json:"status,omitempty"`
	StatusTurns int    `json:"statusTurns,omitempty"`
	Confused    int    `json:"confused,omitempty"`
	Boosts      Boosts `json:"boosts"`
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

// effectiveness is the shared multi-type chart (battle.Effectiveness), matching
// apps/web/lib/battle/typeChart.ts.
func effectiveness(moveType string, defenderTypes []string) float64 {
	return battle.Effectiveness(moveType, defenderTypes)
}

func contains(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}
