package livebattle

import "math"

// Pure combat formulas, mirrored by apps/web/lib/battle/effects.ts for the
// offline simulator. Random rolls are arguments, so testdata/formulas.json pins
// both implementations to the same numbers (formulas_test.go and the web
// battle tests both read it).

const (
	damageScale    = 0.55 // keeps one- to three-card matches to a handful of turns
	baseCritChance = 0.06
)

// confusionHit is the typeless 40-power physical blow a confused creature deals itself.
var confusionHit = Move{ID: "confusion-hit", Name: "Confusion", Type: "Normal", Category: "physical", Power: 40, Accuracy: 100}

func clampStage(stage int) int { return max(-6, min(6, stage)) }

// stageMultiplier scales Atk, Def, SpA, SpD and Speed: +1 is ×1.5, -1 is ×2/3.
func stageMultiplier(stage int) float64 {
	stage = clampStage(stage)
	if stage >= 0 {
		return float64(2+stage) / 2
	}
	return 2 / float64(2-stage)
}

// accuracyMultiplier scales hit chance by the attacker's accuracy minus the target's evasion.
func accuracyMultiplier(stage int) float64 {
	stage = clampStage(stage)
	if stage >= 0 {
		return float64(3+stage) / 3
	}
	return 3 / float64(3-stage)
}

// critChance by critical-hit stage: 6%, 12.5%, 50%, then always.
func critChance(stage int) float64 {
	switch {
	case stage <= 0:
		return baseCritChance
	case stage == 1:
		return 0.125
	case stage == 2:
		return 0.5
	}
	return 1
}

func typeless(m Move) bool { return m.ID == "struggle" || m.ID == confusionHit.ID }

// effectiveSpeed is speed after stat stages and paralysis (halved).
func effectiveSpeed(c *Creature) float64 {
	speed := float64(c.Speed) * stageMultiplier(c.Boosts.Spe)
	if c.Status == "paralysis" {
		speed /= 2
	}
	return speed
}

// hitCount turns a roll in [0,1) into hits: fixed counts as listed, 2–5 as 35/35/15/15%.
func hitCount(e effectView, roll float64) int {
	switch {
	case e.MinHits == 0:
		return 1
	case e.MinHits == e.MaxHits:
		return e.MinHits
	case roll < 0.35:
		return 2
	case roll < 0.7:
		return 3
	case roll < 0.85:
		return 4
	}
	return 5
}

// hitChance is the percentage chance a move lands; 100 or more always hits.
// Self- and field-targeted moves and never-miss moves always hit. Weather can
// make Thunder, Hurricane and Blizzard sure hits (or drop the first two to 50%
// in sun). One-hit KOs ignore accuracy and evasion stages.
func hitChance(m Move, attacker, defender *Creature, weather string) float64 {
	e := effectOf(m)
	if e.Target == "self" || e.Target == "field" || e.NeverMiss {
		return 100
	}
	accuracy := float64(m.Accuracy)
	switch {
	case e.WeatherAccuracy == "rain" && weather == "rain", e.WeatherAccuracy == "snow" && (weather == "snow" || weather == "hail"):
		return 100
	case e.WeatherAccuracy == "rain" && weather == "sun":
		accuracy = 50
	}
	if e.OHKO {
		return accuracy
	}
	return accuracy * accuracyMultiplier(attacker.Boosts.Acc-defender.Boosts.Eva)
}

// damageFor is one hit's damage and type multiplier. Stat stages apply (a crit
// ignores the attacker's drops and the target's raises), burn halves physical
// damage, rain and sun scale Water and Fire moves, and sand and snow raise Rock
// special defence and Ice defence. A landed, non-immune hit deals at least 1.
func damageFor(attacker, defender *Creature, m Move, weather string, crit bool, spread float64) (int, float64) {
	mult := 1.0
	if !typeless(m) {
		mult = effectiveness(m.Type, defender.Types)
	}
	if mult == 0 {
		return 0, 0
	}
	stab := 1.0
	if !typeless(m) && contains(attacker.Types, m.Type) {
		stab = 1.5
	}
	atk, def := float64(attacker.Stats.Atk), float64(defender.Stats.Def)
	atkStage, defStage := attacker.Boosts.Atk, defender.Boosts.Def
	if m.Category == "special" {
		atk, def = float64(attacker.Stats.Spa), float64(defender.Stats.Spd)
		atkStage, defStage = attacker.Boosts.Spa, defender.Boosts.Spd
	}
	if crit {
		atkStage, defStage = max(0, atkStage), min(0, defStage)
	}
	atk *= stageMultiplier(atkStage)
	def *= stageMultiplier(defStage)
	if weather == "sand" && m.Category == "special" && contains(defender.Types, "Rock") ||
		weather == "snow" && m.Category == "physical" && contains(defender.Types, "Ice") {
		def *= 1.5
	}
	modifier := 1.0
	if !typeless(m) {
		switch {
		case weather == "rain" && m.Type == "Water", weather == "sun" && m.Type == "Fire":
			modifier = 1.5
		case weather == "rain" && m.Type == "Fire", weather == "sun" && m.Type == "Water":
			modifier = 0.5
		}
	}
	if attacker.Status == "burn" && m.Category == "physical" {
		modifier *= 0.5
	}
	critMult := 1.0
	if crit {
		critMult = 1.5
	}
	base := ((2*float64(attacker.Level))/5+2)*float64(m.Power)*(atk/def)/50 + 2
	damage := int(math.Round(base * stab * mult * critMult * spread * modifier * damageScale))
	return max(1, damage), mult
}

// residualDamage is the end-of-turn chip: burn 1/16, poison 1/8, bad poison
// step/16, sand (except Rock, Ground, Steel) and hail (except Ice) 1/16. At least 1.
func residualDamage(maxHP int, cause string, step int) int {
	switch cause {
	case "poison":
		return max(1, maxHP/8)
	case "toxic":
		return max(1, maxHP*step/16)
	}
	return max(1, maxHP/16)
}
