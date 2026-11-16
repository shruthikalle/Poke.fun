package livebattle

import (
	"fmt"
	"strings"

	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

const BattleLevel = 50

// Struggle is a deliberate custom rule: typeless, 50 power, always hits and
// costs one quarter of max HP in recoil. It is used only without usable moves.
func Struggle() Move {
	return Move{ID: "struggle", Name: "Struggle", Type: "Normal", Category: "physical", Power: 50, Accuracy: 100, PP: 1, MaxPP: 1}
}

// SpeciesMoves is the species' team-battle moveset, chosen at import time from
// moves the effect model fully supports (scripts/pokedex/teamMoves.mjs). A
// species without one battles with Struggle only; moves are never invented.
func SpeciesMoves(s pokedex.Species) []Move {
	list := s.TeamMoveList()
	if len(list) == 0 {
		return []Move{Struggle()}
	}
	out := make([]Move, len(list))
	for i, m := range list {
		out[i] = Move{ID: m.ID, Name: m.Name, Type: m.Type, Category: m.Category, Power: m.Power,
			Accuracy: m.Accuracy, PP: m.PP, MaxPP: m.PP, Effect: m.Effect}
	}
	return out
}

func SpeciesSprites(s pokedex.Species) Sprites {
	back := strings.Replace(s.Sprite, "/pokemon/", "/pokemon/back/", 1)
	return Sprites{Front: s.Sprite, Back: back, FrontStatic: s.Sprite, BackStatic: back}
}

// CanonicalTeam treats incoming creatures as species selections only. Combat
// fields and move definitions are owned by the server; card art stays cosmetic.
func CanonicalTeam(team []Creature, side string) ([]Creature, error) {
	if len(team) < 1 || len(team) > 3 {
		return nil, fmt.Errorf("a team must contain 1 to 3 creatures")
	}
	seen := map[string]bool{}
	out := make([]Creature, len(team))
	for i, pick := range team {
		key := pick.SpriteID
		if key == "" {
			key = pick.Species
		}
		s, ok := pokedex.Lookup(key)
		if !ok {
			return nil, fmt.Errorf("unknown species %q", key)
		}
		if seen[s.Species] {
			return nil, fmt.Errorf("species clause: duplicate %s", s.Name)
		}
		seen[s.Species] = true
		stats := s.StatsAt(BattleLevel)
		out[i] = Creature{ID: fmt.Sprintf("%s-%d-%s", side, i, s.Key), Species: s.Name, SpriteID: s.Key,
			Sprites: SpeciesSprites(s), Speed: stats.Spe, Stats: Stats{Atk: stats.Atk, Def: stats.Def, Spa: stats.SpA, Spd: stats.SpD},
			CardArt: pick.CardArt, Level: BattleLevel, Types: append([]string(nil), s.Types...), HP: stats.HP, MaxHP: stats.HP, Moves: SpeciesMoves(s)}
	}
	return out, nil
}

// TeamFormat is server-owned display metadata for the custom battle rules.
func TeamFormat(size int, rated bool) Format {
	name := "Champion 1v1"
	if size == 3 {
		name = "Squad of 3"
	}
	return Format{Name: name, Rated: rated, Rules: []Rule{
		{Name: "Species Clause", Description: "One of each base species per team; all creatures are level 50."},
		{Name: "Custom damage", Description: "Priority, then speed, orders hidden turns; 0.55 damage scale; 6% base critical hits."},
		{Name: "Move effects", Description: "Status conditions, confusion, stat stages, priority, multi-hit, drain, recoil, healing, flinch, critical-hit stages, one-hit KOs, forced switches and weather, from each move's data."},
		{Name: "Not modeled", Description: "Abilities, held items, terrain, hazards, screens and moves that depend on them are not used."},
		{Name: "Struggle", Description: "Without supported moves or remaining PP: typeless 50-power attack with 25% max-HP recoil."},
	}}
}

// SetTeam records a PvP player's team. The battle opens once both are in.
func (b *Battle) SetTeam(side string, team []Creature, format Format) error {
	if b.mode != ModePvP {
		return ErrWrongMode
	}
	if side != "p1" && side != "p2" {
		return ErrNotYourTurn
	}
	canonical, err := CanonicalTeam(team, side)
	if err != nil {
		return err
	}
	if len(canonical) != 1 && len(canonical) != 3 {
		return fmt.Errorf("PvP teams must have 1 or 3 creatures")
	}
	expected := formatSize(b.formats["p1"])
	if expected == 0 {
		expected = formatSize(format)
	}
	if expected != 0 && len(canonical) != expected {
		return fmt.Errorf("team does not match the declared format")
	}
	if other := b.initial[otherSide(side)]; len(other) > 0 && len(other) != len(canonical) {
		return fmt.Errorf("both teams must use the same format")
	}
	if existing := b.initial[side]; len(existing) > 0 {
		if len(existing) != len(canonical) {
			return fmt.Errorf("teams are locked")
		}
		for i := range existing {
			if existing[i].SpriteID != canonical[i].SpriteID {
				return fmt.Errorf("teams are locked")
			}
		}
		return nil // reconnecting with the same selections is idempotent
	}
	if b.started {
		return fmt.Errorf("teams are locked")
	}
	b.initial[side] = canonical
	b.formats[side] = TeamFormat(len(canonical), true)
	if len(b.initial["p1"]) > 0 && len(b.initial["p2"]) > 0 {
		b.Open()
	}
	return nil
}

func formatSize(format Format) int {
	switch format.Name {
	case "champion", "Champion 1v1":
		return 1
	case "squad", "Squad of 3":
		return 3
	}
	return 0
}
