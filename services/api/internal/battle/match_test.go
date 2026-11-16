package battle

import (
	"errors"
	"testing"
	"time"
)

func TestMatchResolvesSimultaneousAttacks(t *testing.T) {
	m, err := newFixtureMatch("TESTCODE", "Alice", "emberfox", "alice-token")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Join("Bob", "tidecub", "bob-token"); err != nil {
		t.Fatal(err)
	}
	if err := m.Submit(0, "flare"); !errors.Is(err, ErrInvalidAttack) {
		t.Fatalf("expected unavailable heavy attack, got %v", err)
	}
	if err := m.Submit(0, "claw"); err != nil {
		t.Fatal(err)
	}
	if m.Players[1].HP != 110 {
		t.Fatal("damage resolved before both moves")
	}
	if err := m.Submit(1, "splash"); err != nil {
		t.Fatal(err)
	}
	if m.Players[0].HP != 82 || m.Players[1].HP != 90 {
		t.Fatalf("unexpected HP: %d, %d", m.Players[0].HP, m.Players[1].HP)
	}
	if m.Players[0].Energy != 1 || m.Players[1].Energy != 1 {
		t.Fatal("energy did not increase")
	}
	if m.Turn != 2 || len(m.History) != 1 {
		t.Fatal("turn was not recorded")
	}
}

func TestMatchEndsWhenCardIsKnockedOut(t *testing.T) {
	m, _ := newFixtureMatch("TESTCODE", "Alice", "emberfox", "alice-token")
	_ = m.Join("Bob", "tidecub", "bob-token")
	for m.Winner == "" {
		move := "claw"
		if m.Players[0].Energy >= 2 {
			move = "flare"
		}
		if err := m.Submit(0, move); err != nil {
			t.Fatal(err)
		}
		if err := m.Submit(1, "splash"); err != nil {
			t.Fatal(err)
		}
	}
	if m.Winner != "player1" {
		t.Fatalf("unexpected winner: %s", m.Winner)
	}
	if err := m.Submit(0, "claw"); !errors.Is(err, ErrFinished) {
		t.Fatalf("expected finished error, got %v", err)
	}
}

func TestTypeMultiplier(t *testing.T) {
	cases := []struct {
		attack, defender Element
		want             float64
	}{
		{"Fire", "Grass", 2},   // super effective
		{"Fire", "Water", 0.5}, // resisted
		{"Normal", "Ghost", 0}, // immune
		{"Water", "Fire", 2},   // super effective
		{"Normal", "Fire", 1},  // neutral
		{"Mystery", "Fire", 1}, // unknown element is neutral
	}
	for _, c := range cases {
		if got := TypeMultiplier(c.attack, c.defender); got != c.want {
			t.Errorf("TypeMultiplier(%s, %s) = %v, want %v", c.attack, c.defender, got, c.want)
		}
	}
}

func TestEffectivenessAndStab(t *testing.T) {
	m, _ := newFixtureMatch("TESTCODE", "Alice", "emberfox", "alice-token")
	_ = m.Join("Bob", "mossling", "bob-token")
	m.Players[0].Energy = 2 // let Alice use her heavy Fire attack

	if err := m.Submit(0, "flare"); err != nil { // Fire 45, STAB 1.5, super 2.0 vs Grass
		t.Fatal(err)
	}
	if err := m.Submit(1, "vine"); err != nil { // Normal 16, neutral vs Fire
		t.Fatal(err)
	}
	turn := m.History[0]
	if turn.Damage != [2]int{135, 16} {
		t.Fatalf("unexpected damage with STAB/effectiveness: %v", turn.Damage)
	}
	if turn.Effect != [2]string{"super", "normal"} {
		t.Fatalf("unexpected effectiveness: %v", turn.Effect)
	}
	if m.Winner != "player1" {
		t.Fatalf("a 135-damage super-effective hit should KO 120 HP; winner=%q", m.Winner)
	}
}

func TestSimultaneousKnockoutIsADraw(t *testing.T) {
	m, _ := newFixtureMatch("TESTCODE", "Alice", "emberfox", "alice-token")
	_ = m.Join("Bob", "emberfox", "bob-token")
	for i := range m.Players {
		m.Players[i].Energy = 2
		m.Players[i].HP = 10 // both die to one heavy hit this turn
	}
	_ = m.Submit(0, "flare")
	_ = m.Submit(1, "flare")
	if m.Winner != "draw" {
		t.Fatalf("simultaneous knockout should be a draw, got %q", m.Winner)
	}
	if m.ViewFor(0).Status != "finished" {
		t.Fatal("a draw should finish the match")
	}
}

func TestMatchLocksRulesVersion(t *testing.T) {
	m, _ := newFixtureMatch("TESTCODE", "Alice", "emberfox", "alice-token")
	if m.RulesVersion != RulesVersion || m.CatalogVersion != CatalogVersion {
		t.Fatalf("match did not record versions: %q / %q", m.RulesVersion, m.CatalogVersion)
	}
	view := m.ViewFor(0)
	if view.RulesVersion != RulesVersion || view.CatalogVersion != CatalogVersion {
		t.Fatal("view did not expose rules/catalog version")
	}
}

func TestTurnDeadlineAutoPlaysQuickAttack(t *testing.T) {
	m, _ := newFixtureMatch("TESTCODE", "Alice", "emberfox", "alice-token")
	_ = m.Join("Bob", "tidecub", "bob-token")

	// Nothing is overdue yet.
	if m.ApplyTimeout(time.Now()) {
		t.Fatal("timeout fired before the deadline")
	}

	// Only Alice submits; Bob lets the clock run out.
	if err := m.Submit(0, "claw"); err != nil {
		t.Fatal(err)
	}
	m.Deadline = time.Now().Add(-time.Second)
	if !m.ApplyTimeout(time.Now()) {
		t.Fatal("timeout did not advance the turn")
	}
	turn := m.History[0]
	if turn.Auto != [2]bool{false, true} {
		t.Fatalf("expected Bob's attack to be auto-played, got %v", turn.Auto)
	}
	if m.Turn != 2 || m.Players[1].HP != 90 {
		t.Fatalf("turn did not resolve from the timeout: turn=%d hp=%d", m.Turn, m.Players[1].HP)
	}
	if m.Pending[0] != "" || m.Pending[1] != "" {
		t.Fatal("pending attacks should clear after a resolved turn")
	}
}
