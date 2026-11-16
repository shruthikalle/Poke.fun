package livebattle

import (
	"errors"
	"reflect"
)

func (b *Battle) validateSnapshot() error {
	invalid := errors.New("invalid team battle snapshot")
	if b.trainers == nil || b.formats == nil || b.initial == nil || b.tokens == nil || b.turn < 0 || b.round < 0 {
		return invalid
	}
	if len(b.trainers) != 2 || len(b.initial) > 2 || len(b.tokens) > 2 || len(b.pending) > 1 || len(b.sides) > 2 || len(b.switchQueue) > 2 || len(b.rematchVotes) > 2 {
		return invalid
	}
	if b.weatherTurns < 0 || b.weatherTurns > weatherDuration || (b.weather == "") != (b.weatherTurns == 0) {
		return invalid
	}
	switch b.weather {
	case "", "rain", "sun", "sand", "hail", "snow":
	default:
		return invalid
	}
	for side := range b.tokens {
		if side != "p1" && side != "p2" || b.tokens[side] == "" {
			return invalid
		}
	}
	if b.tokens["p1"] != "" && b.tokens["p1"] == b.tokens["p2"] {
		return invalid
	}
	for _, side := range sides {
		team := b.initial[side]
		if len(team) == 0 {
			if b.started {
				return invalid
			}
			continue
		}
		canonical, err := CanonicalTeam(team, side)
		if err != nil || !reflect.DeepEqual(canonical, team) || b.mode == ModePvP && len(team) != 1 && len(team) != 3 {
			return invalid
		}
		if !b.started {
			continue
		}
		state := b.sides[side]
		if state == nil || state.Side != side || state.Trainer != b.trainers[side] || len(state.Team) != len(team) || state.ActiveIndex < 0 || state.ActiveIndex >= len(team) {
			return invalid
		}
		for i, creature := range state.Team {
			if creature == nil || !validSavedCreature(*creature, team[i]) {
				return invalid
			}
		}
	}
	if !b.started {
		if b.over || b.round != 0 || b.turn != 0 || len(b.pending) != 0 || len(b.switchQueue) != 0 || len(b.sides) != 0 || len(b.log) != 0 {
			return invalid
		}
		return nil
	}
	if b.round < 1 || b.turn < 1 || len(b.log) == 0 || b.mode == ModePvP && (len(b.initial["p1"]) != len(b.initial["p2"]) || !b.timerEnabled) || (!b.over && b.timerEnabled == b.deadline.IsZero()) {
		return invalid
	}
	for side, choice := range b.pending {
		if b.sides[side] == nil || choice == nil || len(b.switchQueue) != 0 || b.over || b.validateChoice(b.sides[side], *choice) != nil {
			return invalid
		}
	}
	seen := map[string]bool{}
	for _, side := range b.switchQueue {
		if b.sides[side] == nil || seen[side] || !b.active(side).Fainted || b.allFainted(side) || b.over {
			return invalid
		}
		seen[side] = true
	}
	for side := range b.rematchVotes {
		if b.sides[side] == nil || !b.over {
			return invalid
		}
	}
	for _, event := range b.log {
		if event == nil || event["type"] == nil {
			return invalid
		}
	}
	if b.over != (b.allFainted("p1") || b.allFainted("p2") || b.ResultReason() == "forfeit") {
		return invalid
	}
	return nil
}

func validSavedCreature(c, initial Creature) bool {
	if c.HP < 0 || c.HP > c.MaxHP || c.Fainted != (c.HP == 0) || len(c.Moves) == 0 {
		return false
	}
	if c.Confused < 0 || c.Confused > 5 || c.StatusTurns < 0 || c.StatusTurns > 15 {
		return false
	}
	switch c.Status {
	case "", "burn", "poison", "toxic", "paralysis", "sleep", "freeze":
	default:
		return false
	}
	for _, stage := range []int{c.Boosts.Atk, c.Boosts.Def, c.Boosts.Spa, c.Boosts.Spd, c.Boosts.Spe, c.Boosts.Acc, c.Boosts.Eva} {
		if stage < -6 || stage > 6 {
			return false
		}
	}
	moves := c.Moves
	c.HP, c.Fainted, c.Moves = initial.HP, initial.Fainted, initial.Moves
	c.Status, c.StatusTurns, c.Confused, c.Boosts = initial.Status, initial.StatusTurns, initial.Confused, initial.Boosts
	if !reflect.DeepEqual(c, initial) {
		return false
	}
	if len(moves) == 1 && moves[0] == Struggle() {
		return true
	}
	if len(moves) != len(initial.Moves) {
		return false
	}
	for i, move := range moves {
		if move.PP < 0 || move.PP > move.MaxPP {
			return false
		}
		move.PP = initial.Moves[i].PP
		if !reflect.DeepEqual(move, initial.Moves[i]) {
			return false
		}
	}
	return true
}
