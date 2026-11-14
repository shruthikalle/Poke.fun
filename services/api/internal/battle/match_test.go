package battle

import (
	"errors"
	"testing"
)

func TestMatchResolvesSimultaneousAttacks(t *testing.T) {
	m, err := NewMatch("TESTCODE", "Alice", "emberfox", "alice-token")
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
	m, _ := NewMatch("TESTCODE", "Alice", "emberfox", "alice-token")
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
