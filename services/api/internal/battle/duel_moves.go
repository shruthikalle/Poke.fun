package battle

import (
	"math"
	"slices"

	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

// Duel moves use only actual damaging learnset entries. Prefer level-up moves;
// the quick move favours low power, the heavy expected STAB power. A species
// with only one supported move has one button, rather than an invented second.
func duelMoves(s pokedex.Species) []pokedex.Move {
	pool := append(s.LevelUpMoves(), s.OtherLearnableMoves()...)
	unique := []pokedex.Move{}
	seen := map[string]bool{}
	for _, m := range pool {
		if seen[m.ID] || m.Power <= 0 || m.PP <= 0 {
			continue
		}
		seen[m.ID] = true
		unique = append(unique, m)
	}
	if len(unique) == 0 {
		return []pokedex.Move{{ID: "struggle", Name: "Struggle", Type: "Normal", Category: "physical", Power: 50, Accuracy: 100, PP: 1}}
	}
	quick := 0
	for i, m := range unique {
		if m.Power < unique[quick].Power || (m.Power == unique[quick].Power && m.Accuracy > unique[quick].Accuracy) {
			quick = i
		}
	}
	out := []pokedex.Move{unique[quick]}
	heavy, best := -1, -1.0
	for i, m := range unique {
		if i == quick {
			continue
		}
		score := float64(m.Power * m.Accuracy)
		if slices.Contains(s.Types, m.Type) {
			score *= 1.5
		}
		if score > best {
			heavy, best = i, score
		}
	}
	if heavy >= 0 {
		out = append(out, unique[heavy])
	}
	return out
}

// Duel attacks are deterministic, always hit, and have unlimited uses. Energy
// replaces PP in this legacy simultaneous format. Only Struggle has recoil;
// move secondary effects, Transform and abilities are not implemented.
func baseDamage(c Card, a Attack, defence int) int {
	atk := c.Stats.Atk
	if a.Category == "special" {
		atk = c.Stats.SpA
	}
	return max(1, int(math.Round((float64(2*c.Level/5+2)*float64(a.Power)*float64(atk)/float64(max(1, defence))/50+2)*0.55)))
}
