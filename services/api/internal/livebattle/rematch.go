package livebattle

// RequestRematch requires both human players to agree to a new round.
func (b *Battle) RequestRematch(side string) error {
	if !b.over {
		return ErrNotYourTurn
	}
	if b.mode == ModePvP {
		b.rematchVotes[side] = true
		if !b.rematchVotes["p1"] || !b.rematchVotes["p2"] {
			b.record(evChat("", b.trainers[side].Name+" requested a rematch."))
			return nil
		}
	}
	b.Open()
	return nil
}

// Result, Trainers and Round let the server persist each completed round once.
func (b *Battle) Result() (string, bool) {
	if !b.over {
		return "", false
	}
	for index := len(b.log) - 1; index >= 0; index-- {
		if b.log[index]["type"] == "win" {
			if winner, ok := b.log[index]["winner"].(string); ok {
				return winner, true
			}
		}
	}
	if b.allFainted("p1") && b.allFainted("p2") {
		return "draw", true
	}
	if b.allFainted("p1") {
		return "p2", true
	}
	return "p1", true
}
func (b *Battle) Trainers() (Trainer, Trainer) { return b.trainers["p1"], b.trainers["p2"] }
func (b *Battle) Round() int                   { return b.round }

// TeamSizes reports each side's locked team size (0 before a team is set).
func (b *Battle) TeamSizes() (int, int) { return len(b.initial["p1"]), len(b.initial["p2"]) }
