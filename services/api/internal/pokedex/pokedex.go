// Package pokedex is the battle server's read-only Pokémon database: every
// species the card catalog can produce, with its types, base stats, sprite,
// power tier and every damaging move it can learn, plus the catalog's card →
// species mapping. It is imported from PokéAPI by scripts/build-pokedex.mjs
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
	Key    string   `json:"key"` // PokéAPI pokemon key, e.g. "pikachu" or "goodra-hisui"
	Name   string   `json:"name"`
	Dex    int      `json:"dex"`
	Types  []string `json:"types"`
	Tier   int      `json:"tier"` // 1–3; matchmaking only pairs equal tiers
	Base   Stats    `json:"base"`
	Sprite string   `json:"sprite"`
	// Learnset holds damaging level-up moves; OtherMoves the damaging moves it
	// learns any other way (TM, tutor, egg). Either may be empty (e.g. Ditto).
	Learnset   []Learned `json:"learnset"`
	OtherMoves []string  `json:"otherMoves"`
}

type Move struct {
	ID       string `json:"-"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Category string `json:"category"` // "physical" or "special"
	Power    int    `json:"power"`
	Accuracy int    `json:"accuracy"`
	PP       int    `json:"pp"`
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
	byName     map[string]string // normalised display name → key
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
		name := normalize(s.Name)
		if prev, taken := ix.byName[name]; taken && prev != s.Key {
			ix.byName[name] = "" // ambiguous, e.g. Nidoran♀ and Nidoran♂: match by set and number only
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

// LevelUpMoves resolves the species' level-up learnset to full moves.
func (s Species) LevelUpMoves() []Move { return resolve(s.learnsetIDs()) }

// OtherLearnableMoves resolves the moves learned by TM, tutor or egg.
func (s Species) OtherLearnableMoves() []Move { return resolve(s.OtherMoves) }

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
