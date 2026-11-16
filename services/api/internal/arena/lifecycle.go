package arena

import "time"

const DisconnectGrace = 30 * time.Second

// Connect and Disconnect describe players, not sockets. The transport calls
// Disconnect only after the last socket for this token leaves.
func (g *Game) Connect(index int, now time.Time) {
	if index < 0 || index > 1 {
		return
	}
	g.Connected[index], g.EverConnected[index] = true, true
	g.DisconnectDeadline[index] = time.Time{}
	if g.EverConnected[0] && g.EverConnected[1] {
		for i := range g.Connected {
			if !g.Connected[i] && g.DisconnectDeadline[i].IsZero() {
				g.DisconnectDeadline[i] = now.Add(DisconnectGrace)
			}
		}
	}
}

func (g *Game) Disconnect(index int, now time.Time) {
	if index < 0 || index > 1 {
		return
	}
	g.Connected[index] = false
	g.Inputs[index] = Input{}
	if g.EverConnected[0] && g.EverConnected[1] && g.Winner == "" {
		g.DisconnectDeadline[index] = now.Add(DisconnectGrace)
	}
}

// RestoreConnections deliberately ignores stale socket state and deadlines.
// Server downtime must never consume a player's reconnect grace.
func (g *Game) RestoreConnections(now time.Time) {
	g.Connected = [2]bool{}
	g.Inputs = [2]Input{}
	g.DisconnectDeadline = [2]time.Time{}
	if g.Winner == "" && g.EverConnected[0] && g.EverConnected[1] {
		for i := range g.DisconnectDeadline {
			g.DisconnectDeadline[i] = now.Add(DisconnectGrace)
		}
	}
}

func (g *Game) Ready() bool {
	return g.Fighters[1] != nil && g.Connected[0] && g.Connected[1] && g.Winner == ""
}

func (g *Game) ApplyDisconnectTimeout(now time.Time) {
	if g.Winner != "" || !g.EverConnected[0] || !g.EverConnected[1] {
		return
	}
	expired := [2]bool{}
	for i, deadline := range g.DisconnectDeadline {
		expired[i] = !g.Connected[i] && !deadline.IsZero() && !now.Before(deadline)
	}
	switch {
	case expired[0] && expired[1]:
		g.Winner = "draw"
	case expired[0]:
		g.Winner = "player2"
	case expired[1]:
		g.Winner = "player1"
	default:
		return
	}
	g.EndReason = "disconnect"
	g.Inputs = [2]Input{}
}

func (g *Game) ResultReason() string {
	if g.Winner == "" {
		return ""
	}
	if g.EndReason == "" {
		g.EndReason = "knockout"
		if g.Fighters[0] != nil && g.Fighters[1] != nil && g.Fighters[0].HP > 0 && g.Fighters[1].HP > 0 && g.Tick >= MatchTicks {
			g.EndReason = "timeout"
		}
	}
	return g.EndReason
}
