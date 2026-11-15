package livebattle

import (
	"fmt"
	"time"
)

// SubmitChoice records a side's hidden choice for the turn. The turn resolves
// once both sides have chosen; against the AI, the bot answers immediately so a
// single player's choice resolves the turn. While a side must replace a fainted
// creature, only that side may act, and only with a switch.
func (b *Battle) SubmitChoice(side string, choice Choice) error {
	switch {
	case b.over:
		return ErrFinished
	case !b.started:
		return ErrNotStarted
	case b.sides[side] == nil:
		return ErrNotYourTurn
	case len(b.switchQueue) > 0:
		return b.forcedSwitch(side, choice)
	case b.pending[side] != nil:
		return ErrNotYourTurn // already locked in this turn
	}
	if err := b.validateChoice(b.sides[side], choice); err != nil {
		return err
	}
	c := choice
	b.pending[side] = &c
	if b.mode == ModeAI && side == "p1" {
		ai := Choice{Kind: "move", MoveIndex: b.pickOpponentMove()}
		b.pending["p2"] = &ai
	}
	if b.pending["p1"] != nil && b.pending["p2"] != nil {
		b.resolveTurn()
	}
	return nil
}

// forcedSwitch brings in a replacement for the side at the head of the queue,
// then either asks the next side to switch or opens the next turn.
func (b *Battle) forcedSwitch(side string, choice Choice) error {
	if b.switchQueue[0] != side {
		return ErrNotYourTurn
	}
	if choice.Kind != "switch" || !b.validSwitch(b.sides[side], choice.TeamIndex) {
		return fmt.Errorf("%w: must switch in a healthy creature", ErrInvalidChoice)
	}
	b.sides[side].ActiveIndex = choice.TeamIndex
	b.switchQueue = b.switchQueue[1:]
	b.record(evResolving(), evSwitch(side, choice.TeamIndex))
	b.record(b.nextDecision()...)
	return nil
}

// nextDecision asks the next queued side to switch, or opens the next turn.
func (b *Battle) nextDecision() []Event {
	if len(b.switchQueue) > 0 {
		b.armDeadline()
		return []Event{evRequest("switching", b.switchQueue[0])}
	}
	return b.beginTurn(false)
}

// ApplyTimeout auto-plays for any side that let the turn deadline pass: the
// first move with PP left, or the first healthy creature for a forced switch.
// It does nothing until the deadline, so it is safe to call on every poll.
// Returns true if it acted.
func (b *Battle) ApplyTimeout(now time.Time) bool {
	if !b.started || b.over || b.deadline.IsZero() || now.Before(b.deadline) {
		return false
	}
	if len(b.switchQueue) > 0 {
		side := b.switchQueue[0]
		b.record(evChat("", fmt.Sprintf("%s ran out of time; a replacement was sent in.", b.trainers[side].Name)))
		return b.forcedSwitch(side, Choice{Kind: "switch", TeamIndex: b.firstAlive(side)}) == nil
	}
	var missing []string
	for _, side := range sides {
		if b.pending[side] == nil && !(b.mode == ModeAI && side == "p2") { // the AI never stalls
			missing = append(missing, side)
		}
	}
	for i, side := range missing {
		if i > 0 && len(b.pending) == 0 {
			break // the previous auto-choice already resolved the turn
		}
		b.record(evChat("", fmt.Sprintf("%s ran out of time; a move was picked automatically.", b.trainers[side].Name)))
		if err := b.SubmitChoice(side, b.autoChoice(side)); err != nil {
			return false
		}
	}
	return true
}

// autoChoice is the timeout fallback: the first move with PP left, or a switch
// to a healthy bench creature if every move is spent.
func (b *Battle) autoChoice(side string) Choice {
	s := b.sides[side]
	for i, m := range s.Team[s.ActiveIndex].Moves {
		if m.PP > 0 {
			return Choice{Kind: "move", MoveIndex: i}
		}
	}
	for i, c := range s.Team {
		if i != s.ActiveIndex && !c.Fainted {
			return Choice{Kind: "switch", TeamIndex: i}
		}
	}
	return Choice{Kind: "move", MoveIndex: 0}
}

func (b *Battle) validateChoice(side *SideState, choice Choice) error {
	switch choice.Kind {
	case "switch":
		if !b.validSwitch(side, choice.TeamIndex) {
			return ErrInvalidChoice
		}
	case "move":
		moves := side.Team[side.ActiveIndex].Moves
		if choice.MoveIndex < 0 || choice.MoveIndex >= len(moves) {
			return ErrInvalidChoice
		}
		// A spent move is only allowed once every move is spent, so a creature
		// that has run out of PP can still fight (a stand-in for "Struggle")
		// instead of leaving the battle stuck.
		if moves[choice.MoveIndex].PP <= 0 && hasPP(moves) {
			return ErrInvalidChoice
		}
	default:
		return ErrInvalidChoice
	}
	return nil
}

func hasPP(moves []Move) bool {
	for _, m := range moves {
		if m.PP > 0 {
			return true
		}
	}
	return false
}

func (b *Battle) validSwitch(side *SideState, index int) bool {
	if index < 0 || index >= len(side.Team) || index == side.ActiveIndex {
		return false
	}
	return !side.Team[index].Fainted
}
