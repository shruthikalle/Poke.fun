package livebattle

import (
	"fmt"

	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

type effectView = pokedex.Effect

// effectOf reads a move's effect; plain damage and Struggle have none.
func effectOf(m Move) effectView {
	if m.Effect == nil {
		return effectView{}
	}
	return *m.Effect
}

// statOrder fixes the order stat changes apply (and are reported) in.
var statOrder = []string{"atk", "def", "spa", "spd", "spe", "acc", "eva"}

var statNames = map[string]string{"atk": "Attack", "def": "Defense", "spa": "Sp. Atk", "spd": "Sp. Def", "spe": "Speed", "acc": "accuracy", "eva": "evasiveness"}

func (bs *Boosts) stage(stat string) *int {
	switch stat {
	case "atk":
		return &bs.Atk
	case "def":
		return &bs.Def
	case "spa":
		return &bs.Spa
	case "spd":
		return &bs.Spd
	case "spe":
		return &bs.Spe
	case "acc":
		return &bs.Acc
	}
	return &bs.Eva
}

// chance draws only for a real gamble, so certain and impossible effects
// leave the seeded random sequence untouched.
func (b *Battle) chance(percent int) bool {
	if percent <= 0 {
		return false
	}
	if percent >= 100 {
		return true
	}
	return b.rng.Float64()*100 < float64(percent)
}

// statusImmune reports whether a creature's types block a major status.
func statusImmune(c *Creature, status, weather string) bool {
	switch status {
	case "burn":
		return contains(c.Types, "Fire")
	case "paralysis":
		return contains(c.Types, "Electric")
	case "poison", "toxic":
		return contains(c.Types, "Poison") || contains(c.Types, "Steel")
	case "freeze":
		return contains(c.Types, "Ice") || weather == "sun"
	}
	return false
}

// turnsBetween rolls an inclusive duration.
func (b *Battle) turnsBetween(low, high int) int {
	if high <= low {
		return low
	}
	return low + int(b.rng.Float64()*float64(high-low+1))
}

// applyAilment inflicts a status or confusion and reports whether it took hold.
// Sleep lasts 1–3 turns (the data's 2–4 count the waking turn); confusion 2–5.
func (b *Battle) applyAilment(side string, e effectView) ([]Event, bool) {
	c := b.active(side)
	if c.Fainted {
		return nil, false
	}
	if e.Ailment == "confusion" {
		if c.Confused > 0 {
			return nil, false
		}
		low, high := e.MinTurns, e.MaxTurns
		if low == 0 {
			low, high = 2, 5
		}
		c.Confused = b.turnsBetween(low, high)
		return []Event{evVolatile(side, "confusion", true)}, true
	}
	if c.Status != "" || statusImmune(c, e.Ailment, b.weather) {
		return nil, false
	}
	c.Status, c.StatusTurns = e.Ailment, 0
	switch e.Ailment {
	case "sleep":
		low, high := e.MinTurns, e.MaxTurns
		if low == 0 {
			low, high = 2, 4
		}
		c.StatusTurns = b.turnsBetween(low-1, high-1)
	case "toxic":
		c.StatusTurns = 1
	}
	return []Event{evStatus(side, c.Status)}, true
}

// applyStats changes stat stages within ±6 and reports each change.
func (b *Battle) applyStats(side string, stats map[string]int) []Event {
	c := b.active(side)
	if c.Fainted {
		return nil
	}
	var events []Event
	for _, stat := range statOrder {
		change, ok := stats[stat]
		if !ok || change == 0 {
			continue
		}
		stage := c.Boosts.stage(stat)
		next := clampStage(*stage + change)
		if next == *stage {
			direction := "higher"
			if change < 0 {
				direction = "lower"
			}
			events = append(events, evChat("", fmt.Sprintf("%s's %s won't go any %s!", c.Species, statNames[stat], direction)))
			continue
		}
		events = append(events, evBoost(side, stat, next-*stage, next))
		*stage = next
	}
	return events
}

// heal restores HP (never above max); a positive amount on a full creature does nothing.
func (b *Battle) heal(side string, amount int) []Event {
	c := b.active(side)
	if amount <= 0 || c.Fainted || c.HP >= c.MaxHP {
		return nil
	}
	c.HP = min(c.MaxHP, c.HP+amount)
	return []Event{evHeal(side, c.HP)}
}

// hurt applies non-attack damage (recoil, residuals, confusion) and faints at 0.
func (b *Battle) hurt(side string, amount int, cause string) []Event {
	c := b.active(side)
	if c.Fainted || amount <= 0 {
		return nil
	}
	c.HP = max(0, c.HP-amount)
	events := []Event{evResidual(side, c.HP, cause)}
	if c.HP == 0 {
		c.Fainted = true
		events = append(events, evFaint(side))
	}
	return events
}

// leaveField clears what does not survive a switch: stat stages, confusion
// and the bad-poison counter. Major status stays.
func leaveField(c *Creature) {
	c.Boosts = Boosts{}
	c.Confused = 0
	if c.Status == "toxic" {
		c.StatusTurns = 1
	}
}

// switchIn makes teamIndex the active creature after the previous one leaves.
func (b *Battle) switchIn(side string, teamIndex int) Event {
	leaveField(b.active(side))
	b.sides[side].ActiveIndex = teamIndex
	return evSwitch(side, teamIndex)
}

// dragOut forces a random healthy bench creature in (Roar, Dragon Tail).
func (b *Battle) dragOut(side string) ([]Event, bool) {
	var bench []int
	for i, c := range b.sides[side].Team {
		if i != b.sides[side].ActiveIndex && !c.Fainted {
			bench = append(bench, i)
		}
	}
	if len(bench) == 0 {
		return nil, false
	}
	next := bench[int(b.rng.Float64()*float64(len(bench)))]
	return []Event{b.switchIn(side, next), evChat("", b.active(side).Species+" was dragged out!")}, true
}

// canAct runs the checks before a move: sleep, freeze, flinch, confusion and
// paralysis, in that order. A confused creature may hurt itself instead.
func (b *Battle) canAct(side string, m Move) ([]Event, bool) {
	c := b.active(side)
	var events []Event
	switch c.Status {
	case "sleep":
		if c.StatusTurns > 0 {
			c.StatusTurns--
			return []Event{evCant(side, "sleep")}, false
		}
		c.Status = ""
		events = append(events, evStatus(side, ""))
	case "freeze":
		if !effectOf(m).ThawsUser && b.rng.Float64() >= 0.2 {
			return []Event{evCant(side, "freeze")}, false
		}
		c.Status = ""
		events = append(events, evStatus(side, ""))
	}
	if b.flinched[side] {
		return append(events, evCant(side, "flinch")), false
	}
	if c.Confused > 0 {
		c.Confused--
		if c.Confused == 0 {
			events = append(events, evVolatile(side, "confusion", false))
		} else if b.rng.Float64() < 1.0/3 {
			damage, _ := damageFor(c, c, confusionHit, b.weather, false, 0.85+b.rng.Float64()*0.15)
			events = append(events, evChat("", c.Species+" hurt itself in its confusion!"))
			return append(events, b.hurt(side, damage, "confusion")...), false
		}
	}
	if c.Status == "paralysis" && b.rng.Float64() < 0.25 {
		return append(events, evCant(side, "paralysis")), false
	}
	return events, true
}
