package livebattle

import (
	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
)

// resolveTurn plays out a turn once both hidden choices are in: switches
// happen first, then moves by priority and speed, then end-of-turn residuals
// (weather, burn, poison). Afterwards fainted creatures are replaced (the AI
// swaps itself in; humans are asked, one side at a time) or the next turn
// opens. All resulting events go to the shared log.
func (b *Battle) resolveTurn() {
	choices := map[string]Choice{"p1": *b.pending["p1"], "p2": *b.pending["p2"]}
	b.pending = map[string]*Choice{}
	b.flinched, b.acted = map[string]bool{}, map[string]bool{}
	events := []Event{evResolving()}

	// Switching takes priority over attacking, as in the games.
	for _, side := range sides {
		if c := choices[side]; c.Kind == "switch" {
			events = append(events, b.switchIn(side, c.TeamIndex))
		}
	}

	for _, act := range b.turnOrder(choices) {
		events = append(events, b.performMove(act.side, act.moveIndex)...)
		if b.checkOver(&events) {
			b.record(events...)
			return // a whole side fainted; the battle is over
		}
	}
	events = append(events, b.residuals()...)
	if b.checkOver(&events) {
		b.record(events...)
		return
	}

	for _, side := range sides {
		if !b.active(side).Fainted {
			continue
		}
		if b.mode == ModeAI && side == "p2" {
			events = append(events, b.switchIn("p2", b.firstAlive("p2")))
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

// turnOrder lists this turn's moves: higher priority first, then the faster
// creature (stat stages and paralysis count; ties broken by the seeded RNG). A
// side that switched spent its turn and does not attack.
func (b *Battle) turnOrder(choices map[string]Choice) []action {
	var order []action
	for _, side := range sides {
		if c := choices[side]; c.Kind == "move" {
			order = append(order, action{side, c.MoveIndex})
		}
	}
	if len(order) < 2 {
		return order
	}
	first, second := b.priorityOf(order[0]), b.priorityOf(order[1])
	if second > first || second == first && b.speedOf(order[1].side) > b.speedOf(order[0].side) {
		order[0], order[1] = order[1], order[0]
	}
	return order
}

func (b *Battle) priorityOf(a action) int {
	return effectOf(b.active(a.side).Moves[a.moveIndex]).Priority
}

// performMove runs one creature's move. A creature that fainted earlier this
// turn cannot act, and a move aimed at a fainted target does nothing.
func (b *Battle) performMove(side string, moveIndex int) []Event {
	attacker := b.active(side)
	defenderSide := otherSide(side)
	if attacker.Fainted || b.active(defenderSide).Fainted {
		return nil
	}
	m := &attacker.Moves[moveIndex]
	events, ok := b.canAct(side, *m)
	if b.acted == nil {
		b.acted = map[string]bool{}
	}
	b.acted[side] = true
	if !ok {
		return events
	}
	struggle := m.ID == "struggle"
	if m.PP > 0 && !struggle {
		m.PP--
	}
	events = append(events, evMove(side, moveIndex, m.PP))
	if m.Category == "status" {
		events = append(events, b.statusMove(side, *m)...)
	} else {
		events = append(events, b.damagingMove(side, *m)...)
	}
	return b.finishMove(side, events, struggle)
}

// landed rolls accuracy; a miss is reported against the target.
func (b *Battle) landed(side string, m Move) bool {
	chance := hitChance(m, b.active(side), b.active(otherSide(side)), b.weather)
	return chance >= 100 || b.rng.Float64()*100 < chance
}

// damagingMove deals one or more hits, then drain or recoil and secondary effects.
func (b *Battle) damagingMove(side string, m Move) []Event {
	e := effectOf(m)
	defenderSide := otherSide(side)
	attacker, defender := b.active(side), b.active(defenderSide)
	if !b.landed(side, m) {
		return []Event{evMiss(defenderSide)}
	}
	if e.OHKO {
		if effectiveness(m.Type, defender.Types) == 0 {
			return []Event{evDamage(defenderSide, defender.HP, "immune", false)}
		}
		defender.HP, defender.Fainted = 0, true
		return []Event{evDamage(defenderSide, 0, "normal", false), evChat("", "It's a one-hit KO!"), evFaint(defenderSide)}
	}
	var events []Event
	roll := 0.0
	if e.MinHits != e.MaxHits {
		roll = b.rng.Float64() // only a 2–5 hit move draws for its count
	}
	hits := hitCount(e, roll)
	total, landedHits, mult := 0, 0, 1.0
	for landedHits < hits && !defender.Fainted {
		crit := b.rng.Float64() < critChance(e.Crit)
		var damage int
		damage, mult = damageFor(attacker, defender, m, b.weather, crit, 0.85+b.rng.Float64()*0.15)
		if mult == 0 {
			return append(events, evDamage(defenderSide, defender.HP, "immune", false))
		}
		defender.HP = max(0, defender.HP-damage)
		total += damage
		landedHits++
		events = append(events, evDamage(defenderSide, defender.HP, battle.EffectivenessLabel(mult), crit))
		if defender.HP == 0 {
			defender.Fainted = true
			events = append(events, evFaint(defenderSide))
		}
	}
	if hits > 1 {
		events = append(events, evHits(defenderSide, landedHits))
	}
	if defender.Status == "freeze" && m.Type == "Fire" && !defender.Fainted {
		defender.Status = ""
		events = append(events, evStatus(defenderSide, ""))
	}
	switch {
	case e.Drain > 0:
		events = append(events, b.heal(side, max(1, total*e.Drain/100))...)
	case e.Drain < 0:
		events = append(events, b.hurt(side, max(1, total*-e.Drain/100), "recoil")...)
	}
	if e.Ailment != "" && b.chance(e.AilmentChance) {
		applied, _ := b.applyAilment(defenderSide, e)
		events = append(events, applied...)
	}
	if len(e.Stats) > 0 && b.chance(e.StatChance) {
		target := defenderSide
		if e.StatTarget == "self" {
			target = side
		}
		events = append(events, b.applyStats(target, e.Stats)...)
	}
	if !defender.Fainted && !b.acted[defenderSide] && b.chance(e.Flinch) {
		b.flinched[defenderSide] = true
	}
	if e.ForceSwitch && !defender.Fainted && !attacker.Fainted {
		dragged, _ := b.dragOut(defenderSide)
		events = append(events, dragged...)
	}
	return events
}

// statusMove applies a non-damaging move; one that changes nothing fails.
func (b *Battle) statusMove(side string, m Move) []Event {
	e := effectOf(m)
	defenderSide := otherSide(side)
	defender := b.active(defenderSide)
	if e.Target == "opponent" && !b.landed(side, m) {
		return []Event{evMiss(defenderSide)}
	}
	var events []Event
	worked := false
	if e.Weather != "" && b.weather != e.Weather {
		b.weather, b.weatherTurns = e.Weather, weatherDuration
		events, worked = append(events, evWeather(e.Weather, weatherDuration)), true
	}
	if e.Ailment != "" {
		blocked := e.Powder && contains(defender.Types, "Grass") ||
			m.Type == "Electric" && effectiveness(m.Type, defender.Types) == 0 // Thunder Wave and Ground types
		if !blocked {
			applied, ok := b.applyAilment(defenderSide, e)
			events, worked = append(events, applied...), worked || ok
		}
	}
	if len(e.Stats) > 0 {
		target := defenderSide
		if e.StatTarget == "self" {
			target = side
		}
		changed := b.applyStats(target, e.Stats)
		events = append(events, changed...)
		for _, event := range changed {
			worked = worked || event["type"] == "boost"
		}
	}
	if e.Healing != 0 {
		healed := b.healingMove(side, e)
		events, worked = append(events, healed...), worked || len(healed) > 0
	}
	if e.ForceSwitch {
		dragged, ok := b.dragOut(defenderSide)
		events, worked = append(events, dragged...), worked || ok
	}
	if !worked {
		events = append(events, evFail(side))
	}
	return events
}

// healingMove restores a share of max HP (weather-scaled for Synthesis and
// friends: ⅔ in sun, ¼ in other weather), or pays an HP cost it can afford.
func (b *Battle) healingMove(side string, e effectView) []Event {
	c := b.active(side)
	if e.Healing < 0 {
		cost := c.MaxHP * -e.Healing / 100
		if c.HP <= cost {
			return nil
		}
		return b.hurt(side, cost, "cost")
	}
	amount := c.MaxHP * e.Healing / 100
	if e.WeatherHeal {
		switch b.weather {
		case "":
		case "sun":
			amount = c.MaxHP * 2 / 3
		default:
			amount = c.MaxHP / 4
		}
	}
	return b.heal(side, amount)
}

const weatherDuration = 5

// residuals run after both moves: weather chip, then burn and poison, then
// the weather counts down. Each active, unfainted creature is affected once.
func (b *Battle) residuals() []Event {
	var events []Event
	for _, side := range sides {
		c := b.active(side)
		switch {
		case c.Fainted:
			continue
		case b.weather == "sand" && !contains(c.Types, "Rock") && !contains(c.Types, "Ground") && !contains(c.Types, "Steel"),
			b.weather == "hail" && !contains(c.Types, "Ice"):
			events = append(events, b.hurt(side, residualDamage(c.MaxHP, b.weather, 0), b.weather)...)
		}
		switch c.Status {
		case "burn", "poison":
			events = append(events, b.hurt(side, residualDamage(c.MaxHP, c.Status, 0), c.Status)...)
		case "toxic":
			events = append(events, b.hurt(side, residualDamage(c.MaxHP, "toxic", c.StatusTurns), "toxic")...)
			c.StatusTurns = min(15, c.StatusTurns+1)
		}
	}
	if b.weather != "" {
		b.weatherTurns--
		if b.weatherTurns <= 0 {
			b.weather, b.weatherTurns = "", 0
			events = append(events, evWeather("", 0))
		}
	}
	return events
}

// checkOver ends the battle if a whole side has fainted, appending the win
// event. Both sides fainting together (recoil, residuals) is a draw.
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

func (b *Battle) speedOf(side string) float64 {
	c := b.active(side)
	return effectiveSpeed(c) + float64(c.Level)/10 + b.rng.Float64()
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

// finishMove applies Struggle recoil and makes the fallback selectable once
// every supported attack is spent. The move-list event keeps both clients honest.
func (b *Battle) finishMove(side string, events []Event, struggle bool) []Event {
	attacker := b.active(side)
	if struggle && !attacker.Fainted {
		attacker.HP = max(0, attacker.HP-max(1, attacker.MaxHP/4))
		events = append(events, evChat("", attacker.Species+" was hurt by Struggle recoil."), evDamage(side, attacker.HP, "normal", false))
		if attacker.HP == 0 {
			attacker.Fainted = true
			events = append(events, evFaint(side))
		}
	}
	if !attacker.Fainted && !hasPP(attacker.Moves) {
		attacker.Moves = []Move{Struggle()}
		events = append(events, Event{"type": "moves", "side": side, "moves": append([]Move(nil), attacker.Moves...)})
	}
	return events
}
