package livebattle

import (
	"encoding/json"
	"testing"
)

func mv(id, typ string, power, pp int) Move {
	return Move{ID: id, Name: id, Type: typ, Category: "physical", Power: power, Accuracy: 100, PP: pp, MaxPP: pp}
}

func creature(id, species string, hp int, types []string, moves []Move) Creature {
	return Creature{
		ID: id, Species: species, SpriteID: species, Level: 50,
		Speed: 50, Stats: Stats{Atk: 100, Def: 60, Spa: 100, Spd: 60},
		Types: types, HP: hp, MaxHP: hp, Moves: moves,
	}
}

func newBattle(t *testing.T, p1, p2 []Creature, seed int64) *Battle {
	t.Helper()
	b, err := New("B1", "tok", Config{
		You:      Trainer{ID: "you", Name: "You", Avatar: "maya"},
		Opponent: Trainer{ID: "opp", Name: "Opp", Avatar: "kai"},
		Teams:    map[string][]Creature{"p1": p1, "p2": p2},
		Format:   Format{Name: "Test", Rated: true},
		Seed:     seed,
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func types(events []Event) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i], _ = e["type"].(string)
	}
	return out
}

func findEvent(events []Event, kind string) Event {
	for _, e := range events {
		if e["type"] == kind {
			return e
		}
	}
	return nil
}

func TestOpenEmitsStartingSequence(t *testing.T) {
	b := newBattle(t,
		[]Creature{creature("a", "emberfox", 100, []string{"Fire"}, []Move{mv("ember", "Fire", 40, 10)})},
		[]Creature{creature("b", "mossling", 100, []string{"Grass"}, []Move{mv("vine", "Grass", 40, 10)})},
		1)
	got := types(b.Open())
	want := []string{"init", "join", "join", "start", "switch", "switch", "turn", "request"}
	if len(got) != len(want) {
		t.Fatalf("opening events = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("opening event %d = %q, want %q (%v)", i, got[i], want[i], got)
		}
	}
}

func TestSuperEffectiveMoveReportsEffectivenessAndCanWin(t *testing.T) {
	// A fast Fire attacker one-shots a frail Grass defender.
	p1 := []Creature{creature("a", "emberfox", 100, []string{"Fire"}, []Move{mv("flare", "Fire", 120, 10)})}
	p1[0].Speed = 200
	p2 := []Creature{creature("b", "mossling", 10, []string{"Grass"}, []Move{mv("vine", "Grass", 40, 10)})}
	b := newBattle(t, p1, p2, 7)
	b.Open()

	events, err := b.Choose(Choice{Kind: "move", MoveIndex: 0})
	if err != nil {
		t.Fatal(err)
	}
	dmg := findEvent(events, "damage")
	if dmg == nil || dmg["effectiveness"] != "super" {
		t.Fatalf("expected a super-effective damage event, got %v", types(events))
	}
	win := findEvent(events, "win")
	if win == nil || win["winner"] != "p1" {
		t.Fatalf("expected p1 to win, got %v", types(events))
	}
	if !b.Over() {
		t.Fatal("battle should be over after a knockout")
	}
}

func TestMoveDecrementsPP(t *testing.T) {
	p1 := []Creature{creature("a", "emberfox", 100, []string{"Fire"}, []Move{mv("ember", "Fire", 40, 5)})}
	p2 := []Creature{creature("b", "tidecub", 100, []string{"Water"}, []Move{mv("splash", "Water", 40, 5)})}
	b := newBattle(t, p1, p2, 3)
	b.Open()
	events, err := b.Choose(Choice{Kind: "move", MoveIndex: 0})
	if err != nil {
		t.Fatal(err)
	}
	// p1's move event should report 4 PP left (started at 5).
	for _, e := range events {
		if e["type"] == "move" && e["side"] == "p1" {
			if e["ppLeft"].(int) != 4 {
				t.Fatalf("expected 4 PP left, got %v", e["ppLeft"])
			}
			return
		}
	}
	t.Fatal("no p1 move event found")
}

func TestRejectsIllegalChoices(t *testing.T) {
	p1 := []Creature{creature("a", "emberfox", 100, []string{"Fire"}, []Move{mv("ember", "Fire", 40, 5)})}
	p2 := []Creature{creature("b", "tidecub", 100, []string{"Water"}, []Move{mv("splash", "Water", 40, 5)})}
	b := newBattle(t, p1, p2, 1)
	b.Open()
	// Switching with only one creature is illegal.
	if _, err := b.Choose(Choice{Kind: "switch", TeamIndex: 0}); err == nil {
		t.Fatal("expected error switching to the active creature")
	}
	// Unknown move index is illegal.
	if _, err := b.Choose(Choice{Kind: "move", MoveIndex: 9}); err == nil {
		t.Fatal("expected error for out-of-range move")
	}
	// A valid move should still be accepted afterward.
	if _, err := b.Choose(Choice{Kind: "move", MoveIndex: 0}); err != nil {
		t.Fatalf("valid move rejected: %v", err)
	}
}

func TestRejectsChoiceAfterBattleEnds(t *testing.T) {
	p1 := []Creature{creature("a", "emberfox", 100, []string{"Fire"}, []Move{mv("flare", "Fire", 120, 10)})}
	p1[0].Speed = 200
	p2 := []Creature{creature("b", "mossling", 10, []string{"Grass"}, []Move{mv("vine", "Grass", 40, 10)})}
	b := newBattle(t, p1, p2, 2)
	b.Open()
	if _, err := b.Choose(Choice{Kind: "move", MoveIndex: 0}); err != nil {
		t.Fatal(err)
	}
	if !b.Over() {
		t.Fatal("expected the battle to be over")
	}
	if _, err := b.Choose(Choice{Kind: "move", MoveIndex: 0}); err != ErrFinished {
		t.Fatalf("expected ErrFinished after the battle ends, got %v", err)
	}
}

func TestDeterministicForSameSeedAndChoices(t *testing.T) {
	build := func() []Event {
		p1 := []Creature{creature("a", "emberfox", 200, []string{"Fire"}, []Move{mv("ember", "Fire", 40, 10)})}
		p2 := []Creature{creature("b", "tidecub", 200, []string{"Water"}, []Move{mv("splash", "Water", 40, 10)})}
		b := newBattle(t, p1, p2, 42)
		all := b.Open()
		for i := 0; i < 3 && !b.Over(); i++ {
			ev, err := b.Choose(Choice{Kind: "move", MoveIndex: 0})
			if err != nil {
				t.Fatal(err)
			}
			all = append(all, ev...)
		}
		return all
	}
	a, _ := json.Marshal(build())
	bb, _ := json.Marshal(build())
	if string(a) != string(bb) {
		t.Fatal("same seed and choices produced different battles")
	}
}

func TestSwitchToBenchCreature(t *testing.T) {
	p1 := []Creature{
		creature("lead", "emberfox", 100, []string{"Fire"}, []Move{mv("ember", "Fire", 40, 10)}),
		creature("bench", "tidecub", 100, []string{"Water"}, []Move{mv("splash", "Water", 40, 10)}),
	}
	p2 := []Creature{creature("b", "mossling", 100, []string{"Grass"}, []Move{mv("vine", "Grass", 40, 10)})}
	b := newBattle(t, p1, p2, 5)
	b.Open()
	events, err := b.Choose(Choice{Kind: "switch", TeamIndex: 1})
	if err != nil {
		t.Fatal(err)
	}
	sw := findEvent(events, "switch")
	if sw == nil || sw["side"] != "p1" || sw["teamIndex"] != 1 {
		t.Fatalf("expected a switch to bench index 1, got %v", types(events))
	}
	if b.sides["p1"].ActiveIndex != 1 {
		t.Fatalf("active index not updated: %d", b.sides["p1"].ActiveIndex)
	}
}
