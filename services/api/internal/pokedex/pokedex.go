// Package pokedex is the battle server's read-only Pokémon database: every
// Pokémon species (default forms plus the alternate forms printed on cards),
// with its types, base stats, sprite, power tier, every move a battle engine can
// use (with its team-battle effect) and its chosen team-battle moveset, plus the card catalog's card → species mapping. It is imported from PokéAPI by scripts/build-pokedex.mjs
// into pokedex.json, which is embedded in the binary, so lookups need no
// network and every server runs the same reviewed, versioned data (PRD N-02).
package pokedex

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
)

//go:embed pokedex.json
var raw []byte

// Stats are base stats as PokéAPI reports them.
type Stats struct {
	HP  int `json:"hp"`
	Atk int `json:"atk"`
	Def int `json:"def"`
	SpA int `json:"spa"`
	SpD int `json:"spd"`
	Spe int `json:"spe"`
}

// Learned is a move a species learns by level-up, and the level it learns it at.
type Learned struct {
	Move  string `json:"move"`
	Level int    `json:"level"`
}

type Species struct {
	Key     string   `json:"key"`     // PokéAPI pokemon key, e.g. "pikachu" or "goodra-hisui"
	Species string   `json:"species"` // base species, e.g. "goodra" for goodra-hisui
	Default bool     `json:"default"` // the species' default form, which a plain name means
	Name    string   `json:"name"`
	Dex     int      `json:"dex"`
	Types   []string `json:"types"`
	Tier    int      `json:"tier"` // 1–3; matchmaking only pairs equal tiers
	Base    Stats    `json:"base"`
	Sprite  string   `json:"sprite"`
	// Learnset holds usable level-up moves; OtherMoves the usable moves it
	// learns any other way (TM, tutor, egg). Either may be empty (e.g. Ditto).
	Learnset   []Learned `json:"learnset"`
	OtherMoves []string  `json:"otherMoves"`
	// TeamMoves is the team-battle moveset chosen at import time
	// (scripts/pokedex/teamMoves.mjs); empty means Struggle only.
	TeamMoves []string `json:"teamMoves"`
}

type Move struct {
	ID       string `json:"-"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Category string `json:"category"` // "physical", "special" or "status"
	Power    int    `json:"power"`
	Accuracy int    `json:"accuracy"`
	PP       int    `json:"pp"`
	// Effect is the team battle's data-driven effect; nil when Unsupported
	// names the behaviour the effect model can't run (see moveEffects.mjs).
	Effect      *Effect `json:"effect,omitempty"`
	Unsupported string  `json:"unsupported,omitempty"`
}

// Damaging moves have listed power; the arena and duel use only these.
func (m Move) Damaging() bool { return m.Power > 0 && m.Category != "status" }

// Effect is a move's team-battle behaviour, normalised from PokéAPI metadata.
// Zero values mean "none"; chances are percentages.
type Effect struct {
	Priority        int            `json:"priority,omitempty"`
	Target          string         `json:"target,omitempty"` // "self", "opponent" or "field"
	Ailment         string         `json:"ailment,omitempty"`
	AilmentChance   int            `json:"ailmentChance,omitempty"`
	MinTurns        int            `json:"minTurns,omitempty"`
	MaxTurns        int            `json:"maxTurns,omitempty"`
	Stats           map[string]int `json:"stats,omitempty"` // atk, def, spa, spd, spe, acc, eva → stages
	StatTarget      string         `json:"statTarget,omitempty"`
	StatChance      int            `json:"statChance,omitempty"`
	Drain           int            `json:"drain,omitempty"`   // % of damage dealt healed; negative is recoil
	Healing         int            `json:"healing,omitempty"` // % of max HP; negative is an HP cost
	Crit            int            `json:"crit,omitempty"`    // critical-hit stage
	Flinch          int            `json:"flinch,omitempty"`
	MinHits         int            `json:"minHits,omitempty"`
	MaxHits         int            `json:"maxHits,omitempty"`
	OHKO            bool           `json:"ohko,omitempty"`
	ForceSwitch     bool           `json:"forceSwitch,omitempty"`
	NeverMiss       bool           `json:"neverMiss,omitempty"`
	Weather         string         `json:"weather,omitempty"`
	WeatherHeal     bool           `json:"weatherHeal,omitempty"`
	WeatherAccuracy string         `json:"weatherAccuracy,omitempty"`
	Powder          bool           `json:"powder,omitempty"`
	ThawsUser       bool           `json:"thawsUser,omitempty"`
}

type cardEntry struct {
	ID      string `json:"id"`
	Set     string `json:"set"`
	Number  string `json:"number"`
	Species string `json:"species"`
}

type cardSet struct {
	ID      string   `json:"id"`
	Aliases []string `json:"aliases"`
}

type dataset struct {
	Version string          `json:"version"`
	Species []Species       `json:"species"`
	Moves   map[string]Move `json:"moves"`
	Cards   struct {
		Sets    []cardSet   `json:"sets"`
		Entries []cardEntry `json:"entries"`
	} `json:"cards"`
}

var db = load(raw)

type index struct {
	dataset
	byKey      map[string]int
	byName     map[string]string // normalised name of a default form → key ("" if ambiguous)
	setByAlias map[string]string
	byCard     map[string]string // "<set id>#<number>" → species key
}

func load(data []byte) *index {
	var d dataset
	if err := json.Unmarshal(data, &d); err != nil {
		panic(fmt.Sprintf("pokedex: invalid pokedex.json: %v", err))
	}
	ix := &index{dataset: d, byKey: map[string]int{}, byName: map[string]string{}, setByAlias: map[string]string{}, byCard: map[string]string{}}
	sort.SliceStable(ix.Species, func(i, j int) bool { return ix.Species[i].Dex < ix.Species[j].Dex })
	for i, s := range ix.Species {
		ix.byKey[s.Key] = i
		if !s.Default {
			continue // forms are reached through their species and a form marker
		}
		name := normalize(s.Name)
		if prev, taken := ix.byName[name]; taken && prev != s.Key {
			ix.byName[name] = "" // ambiguous: never guess between two species
		} else {
			ix.byName[name] = s.Key
		}
	}
	for id, m := range ix.Moves {
		m.ID = id
		ix.Moves[id] = m
	}
	for _, set := range d.Cards.Sets {
		for _, alias := range set.Aliases {
			ix.setByAlias[normalize(alias)] = set.ID
		}
	}
	for _, c := range d.Cards.Entries {
		ix.byCard[c.Set+"#"+normalize(c.Number)] = c.Species
	}
	return ix
}

// Version identifies the dataset (it follows the card catalog's version).
func Version() string { return db.Version }

// All returns every species, ordered by National Dex number. Do not modify it.
func All() []Species { return db.Species }

// Lookup finds a species by its PokéAPI key.
func Lookup(key string) (Species, bool) {
	i, ok := db.byKey[key]
	if !ok {
		return Species{}, false
	}
	return db.Species[i], true
}

// MoveByID returns a move from the shared move table.
func MoveByID(id string) (Move, bool) {
	m, ok := db.Moves[id]
	return m, ok
}

// LevelUpMoves resolves the species' damaging level-up moves (arena and duel).
func (s Species) LevelUpMoves() []Move { return damaging(resolve(s.learnsetIDs())) }

// OtherLearnableMoves resolves the damaging moves learned by TM, tutor or egg.
func (s Species) OtherLearnableMoves() []Move { return damaging(resolve(s.OtherMoves)) }

// TeamMoveList resolves the species' team-battle moveset.
func (s Species) TeamMoveList() []Move { return resolve(s.TeamMoves) }

// LearnableMoves includes supported status moves as well as attacks.
func (s Species) LearnableMoves() []Move {
	return append(resolve(s.learnsetIDs()), resolve(s.OtherMoves)...)
}

func damaging(moves []Move) []Move {
	out := moves[:0:0]
	for _, m := range moves {
		if m.Damaging() {
			out = append(out, m)
		}
	}
	return out
}

func (s Species) learnsetIDs() []string {
	ids := make([]string, len(s.Learnset))
	for i, l := range s.Learnset {
		ids[i] = l.Move
	}
	return ids
}

func resolve(ids []string) []Move {
	out := make([]Move, 0, len(ids))
	for _, id := range ids {
		if m, ok := db.Moves[id]; ok {
			out = append(out, m)
		}
	}
	return out
}

// StatsAt scales base stats to a level with the games' formulas (perfect IVs,
// no EVs): the same numbers the team battle and the devnet powers log use.
// Spe stays the base value; each engine scales speed its own way.
func (s Species) StatsAt(level int) Stats {
	stat := func(base int) int { return (2*base+31)*level/100 + 5 }
	return Stats{
		HP:  (2*s.Base.HP+31)*level/100 + level + 10,
		Atk: stat(s.Base.Atk),
		Def: stat(s.Base.Def),
		SpA: stat(s.Base.SpA),
		SpD: stat(s.Base.SpD),
		Spe: s.Base.Spe,
	}
}
