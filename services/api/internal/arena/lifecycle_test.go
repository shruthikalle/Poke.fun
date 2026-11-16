package arena

import (
	"testing"
	"time"
)

func lifecycleGame(t *testing.T) *Game {
	t.Helper()
	g, err := New("REJOIN", "Alice", "pikachu", "alice-secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := g.Join("Bob", "charmander", "bob-secret"); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestDisconnectGraceStartsOnlyAfterBothEverConnected(t *testing.T) {
	g := lifecycleGame(t)
	now := time.Now()
	g.Connect(0, now)
	g.Disconnect(0, now)
	g.ApplyDisconnectTimeout(now.Add(time.Hour))
	if g.Winner != "" || !g.DisconnectDeadline[0].IsZero() {
		t.Fatal("punished a player before their opponent ever connected")
	}
	g.Connect(1, now.Add(time.Hour))
	if g.DisconnectDeadline[0] != now.Add(time.Hour+DisconnectGrace) {
		t.Fatal("first player did not receive fresh grace when opponent arrived")
	}
	g.Connect(0, now.Add(time.Hour+DisconnectGrace-time.Millisecond))
	g.ApplyDisconnectTimeout(now.Add(2 * time.Hour))
	if g.Winner != "" || !g.Ready() {
		t.Fatal("successful rejoin forfeited")
	}
}

func TestDisconnectForfeitAndBothAbsentDraw(t *testing.T) {
	for _, both := range []bool{false, true} {
		g := lifecycleGame(t)
		now := time.Now()
		g.Connect(0, now)
		g.Connect(1, now)
		g.SetInput(0, Input{DX: 1, Basic: true})
		g.Disconnect(0, now)
		if both {
			g.Disconnect(1, now)
		}
		if g.Ready() || g.Inputs[0] != (Input{}) {
			t.Fatal("disconnected input or clock remained active")
		}
		g.ApplyDisconnectTimeout(now.Add(DisconnectGrace - time.Millisecond))
		if g.Winner != "" {
			t.Fatal("grace ended early")
		}
		g.ApplyDisconnectTimeout(now.Add(DisconnectGrace))
		want := "player2"
		if both {
			want = "draw"
		}
		if g.Winner != want || g.ResultReason() != "disconnect" {
			t.Fatalf("outcome = %s, %s", g.Winner, g.ResultReason())
		}
	}
}

func TestRestoreConnectionsGrantsFullFreshGrace(t *testing.T) {
	g := lifecycleGame(t)
	before := time.Now().Add(-time.Hour)
	g.Connect(0, before)
	g.Connect(1, before)
	g.Disconnect(0, before)
	now := time.Now()
	g.RestoreConnections(now)
	g.ApplyDisconnectTimeout(now.Add(DisconnectGrace - time.Millisecond))
	if g.Winner != "" || g.Ready() {
		t.Fatal("server downtime consumed grace or retained sockets")
	}
	g.Connect(0, now)
	g.Connect(1, now)
	if g.PlayerIndex("alice-secret") != 0 || g.PlayerIndex("bob-secret") != 1 || !g.Ready() {
		t.Fatal("restore changed credentials")
	}
}

func TestResultReasonPreservesExplicitAndInfersCombat(t *testing.T) {
	for _, reason := range []string{"timeout", "knockout", "forfeit", "disconnect"} {
		g := lifecycleGame(t)
		switch reason {
		case "forfeit":
			_ = g.Forfeit(0)
		case "disconnect":
			g.Winner, g.EndReason = "player2", reason
		case "timeout":
			g.Winner, g.Tick = "draw", MatchTicks
		default:
			g.Winner, g.Fighters[0].HP = "player2", 0
		}
		if g.ResultReason() != reason || g.ViewFor(0).EndReason != reason {
			t.Fatalf("reason = %s, want %s", g.ResultReason(), reason)
		}
	}
}
