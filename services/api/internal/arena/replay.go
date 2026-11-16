package arena

// ReplayFrame is the public arena state after a simulation tick. Recording
// frames captures dodges, aim and hits even when the game ends by forfeit.
type ReplayFighter struct {
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	HP        int     `json:"hp"`
	Energy    int     `json:"energy"`
	Attack    string  `json:"attack,omitempty"`
	AttackHit bool    `json:"attackHit,omitempty"`
}

type ReplayFrame struct {
	Tick     int              `json:"tick"`
	Fighters [2]ReplayFighter `json:"fighters"`
	Winner   string           `json:"winner,omitempty"`
}

func (g *Game) ReplayFrame() ReplayFrame {
	frame := ReplayFrame{Tick: g.Tick, Winner: g.Winner}
	for i, f := range g.Fighters {
		if f != nil {
			frame.Fighters[i] = ReplayFighter{X: f.X, Y: f.Y, HP: f.HP, Energy: f.Energy,
				Attack: f.LastAttack, AttackHit: f.LastAttackHit}
		}
	}
	return frame
}

// Replay returns a copy that also includes a final forfeit/disconnect state.
func (g *Game) Replay() []ReplayFrame {
	frames := append([]ReplayFrame(nil), g.Frames...)
	last := g.ReplayFrame()
	if len(frames) == 0 || frames[len(frames)-1] != last {
		frames = append(frames, last)
	}
	return frames
}
