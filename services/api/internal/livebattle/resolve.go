package livebattle

import (
	"math"

	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
)

// resolveTurn plays out a turn once both hidden choices are in: switches
// happen first, then moves in speed order. Afterwards fainted creatures are
// replaced (the AI swaps itself in; humans are asked, one side at a time) or
// the next turn opens. All resulting events go to the shared log.
func (b *Battle) resolveTurn() {
	choices := map[string]Choice{"p1": *b.pending["p1"], "p2": *b.pending["p2"]}
	b.pending = map[string]*Choice{}
	events := []Event{evResolving()}

	// Switching takes priority over attacking, as in the games.
	for _, side := range sides {
		if c := choices[side]; c.Kind == "switch" {
			b.sides[side].ActiveIndex = c.TeamIndex
			events = append(events, evSwitch(side, c.TeamIndex))
		}
	}

	for _, act := range b.turnOrder(choices) {
		events = append(events, b.performMove(act.side, act.moveIndex)...)
		if b.checkOver(&events) {
			b.record(events...)
			return // a whole side fainted; the battle is over
		}
	}

	for _, side := range sides {
		if !b.active(side).Fainted {
			continue
		}
		if b.mode == ModeAI && side == "p2" {
			next := b.firstAlive("p2")
			b.sides["p2"].ActiveIndex = next
			events = append(events, evSwitch("p2", next))
			continue
		}
		b.switchQueue = append(b.switchQueue, side)
	}
	b.record(events...)
	b.record(b.nextDecision()...)
}

type action struct {
	side      string
	moveIndex int
}

// turnOrder lists this turn's moves, faster creature first. A side that
// switched spent its turn and does not attack.
func (b *Battle) turnOrder(choices map[string]Choice) []action {
	var order []action
	for _, side := range sides {
		if c := choices[side]; c.Kind == "move" {
			order = append(order, action{side, c.MoveIndex})
		}
	}
	// Faster creature acts first; ties broken by the seeded RNG inside speedOf.
	if len(order) == 2 && b.speedOf(order[1].side) > b.speedOf(order[0].side) {
		order[0], order[1] = order[1], order[0]
	}
	return order
}

// performMove runs one creature's move: accuracy check, damage and faint. A
// creature that fainted earlier this turn cannot act and deals nothing.
func (b *Battle) performMove(side string, moveIndex int) []Event {
	attacker := b.active(side)
	defenderSide := otherSide(side)
	defender := b.active(defenderSide)
	if attacker.Fainted || defender.Fainted {
		return nil
	}
	m := &attacker.Moves[moveIndex]
	if m.PP > 0 {
		m.PP--
	}
	events := []Event{evMove(side, moveIndex, m.PP)}

	if b.rng.Float64()*100 >= float64(m.Accuracy) {
		return append(events, evMiss(defenderSide))
	}

	damage, mult, crit := b.computeDamage(attacker, defender, *m)
	defender.HP = max(0, defender.HP-damage)
	events = append(events, evDamage(defenderSide, defender.HP, battle.EffectivenessLabel(mult), crit))
	if defender.HP == 0 {
		defender.Fainted = true
		events = append(events, evFaint(defenderSide))
	}
	return events
}

// computeDamage applies the standard damage formula with same-type attack bonus
// (STAB), type effectiveness, crits and a small random spread. The result is
// scaled below the games' numbers (the 0.55 factor) so one- to three-card
// matches last a satisfying handful of turns rather than ending in one hit.
func (b *Battle) computeDamage(attacker, defender *Creature, m Move) (damage int, mult float64, crit bool) {
	mult = effectiveness(m.Type, defender.Types)
	if mult == 0 {
		return 0, 0, false // immune
	}
	stab := 1.0
	if contains(attacker.Types, m.Type) {
		stab = 1.5
	}
	crit = b.rng.Float64() < 0.06
	critMult := 1.0
	if crit {
		critMult = 1.5
	}
	atk, def := attacker.Stats.Atk, defender.Stats.Def
	if m.Category == "special" {
		atk, def = attacker.Stats.Spa, defender.Stats.Spd
	}
	base := (((2*float64(attacker.Level))/5+2)*float64(m.Power)*(float64(atk)/float64(def)))/50 + 2
	spread := 0.85 + b.rng.Float64()*0.15
	damage = int(math.Round(base * stab * mult * critMult * spread * 0.55))
	if damage < 1 {
		damage = 1 // a landed, non-immune hit always chips at least 1
	}
	return damage, mult, crit
}

// checkOver ends the battle if a whole side has fainted, appending the win
// event. Because faints are checked after each action, the first side wiped
// ends play immediately, so "draw" only guards a theoretical double-wipe.
func (b *Battle) checkOver(events *[]Event) bool {
	p1Out := b.allFainted("p1")
	p2Out := b.allFainted("p2")
	if !p1Out && !p2Out {
		return false
	}
	b.over = true
	winner := "p1"
	switch {
	case p1Out && p2Out:
		winner = "draw"
	case p1Out:
		winner = "p2"
	}
	*events = append(*events, evWin(winner))
	return true
}

// pickOpponentMove is the AI (side p2) policy: score each move by power × type
// effectiveness with a little randomness, so the bot favours strong,
// super-effective moves without being perfectly predictable. It chooses at the
// same moment the human does, against the creature the human currently has out.
func (b *Battle) pickOpponentMove() int {
	attacker := b.active("p2")
	defender := b.active("p1")
	best, bestScore := 0, math.Inf(-1)
	for i, m := range attacker.Moves {
		score := -1.0 // a move with no PP is a last resort
		if m.PP > 0 {
			score = float64(m.Power) * effectiveness(m.Type, defender.Types) * (0.7 + b.rng.Float64()*0.6)
		}
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	return best
}

// speedOf adds a fractional RNG jitter so equal-speed creatures break ties
// randomly rather than always favouring one side.
func (b *Battle) speedOf(side string) float64 {
	c := b.active(side)
	return float64(c.Speed) + float64(c.Level)/10 + b.rng.Float64()
}

func (b *Battle) active(side string) *Creature {
	s := b.sides[side]
	return s.Team[s.ActiveIndex]
}

func (b *Battle) firstAlive(side string) int {
	for i, c := range b.sides[side].Team {
		if !c.Fainted {
			return i
		}
	}
	return 0
}

func (b *Battle) allFainted(side string) bool {
	for _, c := range b.sides[side].Team {
		if !c.Fainted {
			return false
		}
	}
	return true
}

func otherSide(side string) string {
	if side == "p1" {
		return "p2"
	}
	return "p1"
}
