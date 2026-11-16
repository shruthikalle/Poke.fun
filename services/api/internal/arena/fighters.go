package arena

import (
	"math"
	"slices"
	"sort"

	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

// Every species in the Pokédex dataset is an arena fighter. Its stats and its
// two moves are derived from PokéAPI data by the rules below, which are
// calibrated so the original hand-tuned Pikachu and Charmander keep their feel.
// See docs/game-mechanics.md, "Live arena".

const (
	FighterLevel  = 50
	BasicRange    = 140
	RadiusRange   = 225 // specials that burst around the attacker
	ConeRange     = 205 // specials sprayed ahead in a cone
	ConeHalfAngle = 26  // degrees either side of the aim
	ShapeRadius   = "radius"
	ShapeCone     = "cone"

	damageScale     = 0.42 // fits the games' damage formula to arena HP and pace
	maxPower        = 120  // caps the strongest moves so no special one-shots
	basicPower      = 40   // every basic attack is a 40-power jab
	minSpecialPower = 60   // a weaker same-type move doesn't qualify as a signature special
	clearLean       = 1.2  // Atk or SpA this much higher decides which category to favour
	referenceStat   = 70   // Def/SpD of an average level-50 target, for displayed damage
)

// coneTypes spray a breath or stream ahead of the attacker; specials of any
// other type burst in a radius around it.
var coneTypes = map[string]bool{"Fire": true, "Water": true, "Ice": true, "Grass": true, "Poison": true, "Dragon": true, "Flying": true}

// unusable moves have effects the arena can't honour (the user faints, or they
// need sleep or an opening turn), so they are never picked.
var unusable = map[string]bool{
	"explosion": true, "self-destruct": true, "misty-explosion": true, "mind-blown": true,
	"dream-eater": true, "snore": true, "belch": true, "last-resort": true,
	"synchronoise": true, "fake-out": true, "first-impression": true, "steel-roller": true,
	"future-sight": true, "doom-desire": true, // land two turns later
}

// Struggle is an explicit fallback, never an invented learnset entry. It is
// typeless, has no STAB, and recoils for one quarter of max HP on a landed hit.
var fallbackStruggle = pokedex.Move{ID: "struggle", Name: "Struggle", Type: "Normal", Category: "physical", Power: 50, Accuracy: 100, PP: 1}

type Move struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Category string `json:"category"` // "physical" uses Atk vs Def, "special" SpA vs SpD
	Power    int    `json:"power"`
	// Damage is the hit against an average, neutral target, for display. Real
	// hits depend on the target's defence and types (hitDamage).
	Damage     int     `json:"damage"`
	Range      float64 `json:"range"`
	CooldownMs int     `json:"cooldownMs"`
	Shape      string  `json:"shape,omitempty"` // specials only: radius or cone
}

type Stats struct {
	Atk int `json:"atk"`
	Def int `json:"def"`
	SpA int `json:"spa"`
	SpD int `json:"spd"`
}

type Card struct {
	ID      string   `json:"id"` // species key, e.g. "pikachu"
	Name    string   `json:"name"`
	Type    string   `json:"type"` // primary type
	Types   []string `json:"types"`
	Tier    int      `json:"tier"` // matchmaking only pairs equal tiers
	Level   int      `json:"level"`
	MaxHP   int      `json:"maxHp"`
	Speed   float64  `json:"speed"` // movement in arena units per second
	Stats   Stats    `json:"stats"`
	Sprite  string   `json:"sprite"`
	Basic   Move     `json:"basic"`
	Special Move     `json:"special"`
}

var roster, rosterByID = buildRoster()

func buildRoster() ([]Card, map[string]Card) {
	species := pokedex.All()
	cards := make([]Card, len(species))
	byID := make(map[string]Card, len(species))
	for i, s := range species {
		cards[i] = newCard(s)
		byID[s.Key] = cards[i]
	}
	return cards, byID
}

// Cards lists every fighter, ordered by National Dex number. Do not modify it.
func Cards() []Card { return roster }

// FindCard returns the fighter for a species key.
func FindCard(id string) (Card, bool) {
	c, ok := rosterByID[id]
	return c, ok
}

func newCard(s pokedex.Species) Card {
	st := s.StatsAt(FighterLevel)
	spe := float64(s.Base.Spe)
	c := Card{
		ID: s.Key, Name: s.Name, Type: s.Types[0], Types: s.Types, Tier: s.Tier,
		Level: FighterLevel, MaxHP: st.HP, Sprite: s.Sprite,
		// Base speed 90 (Pikachu) moves at 250; clamped so slow species stay playable.
		Speed: clamp(160+spe, 170, 300),
		Stats: Stats{Atk: st.Atk, Def: st.Def, SpA: st.SpA, SpD: st.SpD},
	}
	basic := pickBasic(s)
	special := pickSpecial(s, basic.ID)
	shape := ShapeRadius
	if coneTypes[special.Type] {
		shape = ShapeCone
	}
	// Faster species attack more often: 450 ms / 4.5 s at base speed 90.
	c.Basic = arenaMove(basic, BasicRange, int(clamp(roundTo(700-2.8*spe, 50), 400, 700)), "")
	if basic.ID != "struggle" {
		c.Basic.Power = basicPower
	}
	c.Special = arenaMove(special, map[string]float64{ShapeRadius: RadiusRange, ShapeCone: ConeRange}[shape], int(clamp(roundTo(6300-20*spe, 100), 3500, 6000)), shape)
	reference := Card{Stats: Stats{Def: referenceStat, SpD: referenceStat}}
	c.Basic.Damage = hitDamage(c, c.Basic, reference)
	c.Special.Damage = hitDamage(c, c.Special, reference)
	return c
}

func arenaMove(m pokedex.Move, reach float64, cooldownMs int, shape string) Move {
	return Move{ID: m.ID, Name: m.Name, Type: m.Type, Category: m.Category, Power: m.Power, Range: reach, CooldownMs: cooldownMs, Shape: shape}
}

// leaning reports which category a species is clearly better at: "physical"
// when its Atk is at least clearLean times its SpA, "special" the other way
// round, or "" when they are close (Pikachu and Charmander are close).
func leaning(s pokedex.Species) string {
	atk, spa := float64(s.Base.Atk), float64(s.Base.SpA)
	switch {
	case atk >= clearLean*spa:
		return "physical"
	case spa >= clearLean*atk:
		return "special"
	}
	return ""
}

// pickBasic chooses the quick jab's flavour: the weakest reliable (100%
// accurate) move of 35–60 power in the species' stronger category (physical
// when there is no clear lean), learned as early as possible. Pikachu gets
// Quick Attack, Charmander Scratch and Abra Confusion. Level-up moves come first.
func pickBasic(s pokedex.Species) pokedex.Move {
	category := leaning(s)
	if category == "" {
		category = "physical"
	}
	for _, pool := range [][]pokedex.Move{s.LevelUpMoves(), s.OtherLearnableMoves()} {
		var candidates []pokedex.Move
		for _, m := range pool {
			if !unusable[m.ID] && m.Accuracy == 100 && m.Power >= 35 && m.Power <= 60 {
				candidates = append(candidates, m)
			}
		}
		// Stable: ties keep learnset order (level learned, then id).
		sort.SliceStable(candidates, func(i, j int) bool {
			ci, cj := candidates[i].Category == category, candidates[j].Category == category
			if ci != cj {
				return ci
			}
			return candidates[i].Power < candidates[j].Power
		})
		if len(candidates) > 0 {
			return candidates[0]
		}
	}
	// Some species have damaging moves outside the preferred quick-power band.
	for _, pool := range [][]pokedex.Move{s.LevelUpMoves(), s.OtherLearnableMoves()} {
		for _, m := range pool {
			if !unusable[m.ID] {
				return m
			}
		}
	}
	return fallbackStruggle
}

// pickSpecial chooses the signature attack, by expected power (power ×
// accuracy): first a same-type move of at least minSpecialPower in the
// species' stronger category (special when there is no clear lean), then any
// same-type move, then any move in that category, then any move at all.
// Pikachu gets Thunderbolt, Charmander Flamethrower, Geodude Earthquake.
// Level-up moves come first.
func pickSpecial(s pokedex.Species, basicID string) pokedex.Move {
	category := leaning(s)
	if category == "" {
		category = "special"
	}
	sameType := func(m pokedex.Move) bool { return slices.Contains(s.Types, m.Type) }
	preferences := []func(pokedex.Move) bool{
		func(m pokedex.Move) bool { return sameType(m) && m.Category == category && m.Power >= minSpecialPower },
		sameType,
		func(m pokedex.Move) bool { return m.Category == category },
		func(pokedex.Move) bool { return true },
	}
	for _, pool := range [][]pokedex.Move{s.LevelUpMoves(), s.OtherLearnableMoves()} {
		for _, accept := range preferences {
			best, bestScore := pokedex.Move{}, -1.0
			for _, m := range pool {
				if unusable[m.ID] || m.ID == basicID || !accept(m) {
					continue
				}
				if score := float64(min(m.Power, maxPower)) * float64(m.Accuracy) / 100; score > bestScore {
					best, bestScore = m, score
				}
			}
			if bestScore >= 0 {
				return best
			}
		}
	}
	return fallbackStruggle
}

// hitDamage applies the games' damage formula at level 50, without random
// rolls or crits so the real-time arena stays deterministic: the attacker's
// Atk or SpA against the target's Def or SpD, scaled to arena HP. Specials add
// the same-type bonus and type effectiveness (immune targets take 0). Basics
// are typeless jabs: no bonus, no matchups, so they always chip damage and
// build energy (a Normal-type basic could otherwise never touch a Ghost).
// Every landed, non-immune hit deals at least 1.
func hitDamage(attacker Card, m Move, target Card) int {
	basic := m.Shape == ""
	mult := 1.0
	if !basic && m.ID != "struggle" {
		mult = battle.Effectiveness(m.Type, target.Types)
	}
	if mult == 0 {
		return 0
	}
	atk, def := attacker.Stats.Atk, target.Stats.Def
	if m.Category == "special" {
		atk, def = attacker.Stats.SpA, target.Stats.SpD
	}
	levelFactor := float64(2*FighterLevel/5 + 2)
	base := levelFactor*float64(min(m.Power, maxPower))*float64(atk)/float64(def)/50 + 2
	stab := 1.0
	if !basic && m.ID != "struggle" && slices.Contains(attacker.Types, m.Type) {
		stab = 1.5
	}
	return max(1, int(math.Round(base*stab*mult*damageScale)))
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func roundTo(v, step float64) float64 { return math.Round(v/step) * step }
