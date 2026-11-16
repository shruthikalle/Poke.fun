package livebattle

import "time"

// Forfeit ends the match without inventing knockout damage. The terminal event
// carries the result; current HP remains available for the saved game record.
func (b *Battle) Forfeit(side string) error {
	if side != "p1" && side != "p2" {
		return ErrNotYourTurn
	}
	if !b.started {
		return ErrNotStarted
	}
	if b.over {
		return ErrFinished
	}
	b.over = true
	b.pending = map[string]*Choice{}
	b.deadline = time.Time{}
	b.record(evChat("", b.trainers[side].Name+" forfeited the match."),
		Event{"type": "win", "winner": otherSide(side), "reason": "forfeit"})
	return nil
}

func (b *Battle) ResultReason() string {
	if !b.over {
		return ""
	}
	for index := len(b.log) - 1; index >= 0; index-- {
		if b.log[index]["type"] == "win" {
			if reason, ok := b.log[index]["reason"].(string); ok {
				return reason
			}
			return "knockout"
		}
	}
	return "knockout"
}
