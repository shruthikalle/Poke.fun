package livebattle

import "math"

// AI (side p2) policy, mirrored by apps/web/lib/battle/effects.ts. Each move is
// valued, then scaled by a 0.7–1.3 random factor so the bot is strong but not
// perfectly predictable. It chooses when the human does, against the creature
// the human currently has out. A move with no PP is a last resort.
func (b *Battle) pickOpponentMove() int {
	attacker := b.active("p2")
	defender := b.active("p1")
	best, bestScore := 0, math.Inf(-1)
	for i, m := range attacker.Moves {
		score := -1.0
		if m.PP > 0 {
			score = moveValue(m, attacker, defender, b.weather) * (0.7 + b.rng.Float64()*0.6)
		}
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	return best
}

var ailmentValue = map[string]float64{"sleep": 80, "paralysis": 70, "toxic": 70, "burn": 65, "poison": 50, "confusion": 45, "freeze": 60}

// moveValue scores a move in the current position. Damage is power × type
// effectiveness × expected hits; support moves are worth roughly a strong hit
// when they would change something, and nothing when they would fail.
func moveValue(m Move, attacker, defender *Creature, weather string) float64 {
	e := effectOf(m)
	if m.Category != "status" && !e.OHKO {
		hits := 1.0
		if e.MinHits > 0 {
			hits = float64(e.MinHits)
			if e.MinHits != e.MaxHits {
				hits = 3.1
			}
		}
		if typeless(m) {
			return float64(m.Power)
		}
		return float64(m.Power) * effectiveness(m.Type, defender.Types) * hits
	}
	if e.OHKO {
		return 30 * float64(m.Accuracy) / 100 * effectiveness(m.Type, defender.Types)
	}
	value := 0.0
	if e.Weather != "" && weather != e.Weather {
		value += 50
	}
	if e.Ailment == "confusion" && defender.Confused == 0 {
		value += ailmentValue["confusion"]
	} else if e.Ailment != "" && defender.Status == "" && !statusImmune(defender, e.Ailment, weather) &&
		!(e.Powder && contains(defender.Types, "Grass")) && !(m.Type == "Electric" && effectiveness(m.Type, defender.Types) == 0) {
		value += ailmentValue[e.Ailment]
	}
	for _, stat := range statOrder {
		change := e.Stats[stat]
		if e.StatTarget == "self" && change > 0 && *attacker.Boosts.stage(stat) < 4 {
			weight := 15.0
			if stat == "atk" || stat == "spa" || stat == "spe" {
				weight = 30
			}
			value += weight * float64(change)
		} else if e.StatTarget == "opponent" && change < 0 && *defender.Boosts.stage(stat) > -4 {
			value += 15 * float64(-change)
		}
	}
	if e.Healing > 0 && attacker.HP*2 < attacker.MaxHP {
		value += 2.4 * float64(e.Healing)
	}
	if e.ForceSwitch {
		value += 5
	}
	return value
}
