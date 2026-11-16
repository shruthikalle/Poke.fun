package livebattle

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func mv(id, typ string, power, pp int) Move {
	return Move{ID: id, Name: id, Type: typ, Category: "physical", Power: power, Accuracy: 100, PP: pp, MaxPP: pp}
}

func creature(id, species string, hp int, types []string, moves ...Move) Creature {
	return Creature{
		ID: id, Species: species, SpriteID: species, Level: 50,
		Speed: 50, Stats: Stats{Atk: 100, Def: 60, Spa: 100, Spd: 60},
		Types: types, HP: hp, MaxHP: hp, Moves: moves,
	}
}

var (
	you = Trainer{ID: "you", Name: "You", Avatar: "maya"}
	opp = Trainer{ID: "opp", Name: "Opp", Avatar: "kai"}
)

func newAI(t *testing.T, p1, p2 []Creature, seed int64) *Battle {
	t.Helper()
	b, err := New("B1", Config{Mode: ModePvP, You: you, Opponent: opp, Seed: seed})
	if err != nil {
		t.Fatal(err)
	}
	b.mode = ModeAI
	b.timerEnabled = false
	b.initial = map[string][]Creature{"p1": p1, "p2": p2}
	b.Open()
	return b
}

func newPvP(t *testing.T, p1, p2 []Creature, seed int64) *Battle {
	t.Helper()
	b, err := New("B2", Config{Mode: ModePvP, You: you, Opponent: opp, Seed: seed})
	if err != nil {
		t.Fatal(err)
	}
	b.initial = map[string][]Creature{"p1": p1, "p2": p2}
	b.Open()
	return b
}

// since returns the events recorded after *cursor and advances it, the way a
// polling client reads the shared log.
func since(b *Battle, cursor *int) []Event {
	events, next := b.EventsSince(*cursor)
	*cursor = next
	return events
}

func kinds(events []Event) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i], _ = e["type"].(string)
	}
	return out
}

func find(events []Event, kind string) Event {
	for _, e := range events {
		if e["type"] == kind {
			return e
		}
	}
	return nil
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func move0() Choice { return Choice{Kind: "move", MoveIndex: 0} }

// ── Shared rules (AI mode) ──

func TestOpenEmitsStartingSequence(t *testing.T) {
	b := newAI(t,
		[]Creature{creature("a", "emberfox", 100, []string{"Fire"}, mv("ember", "Fire", 40, 10))},
		[]Creature{creature("b", "mossling", 100, []string{"Grass"}, mv("vine", "Grass", 40, 10))}, 1)
	cursor := 0
	got := strings.Join(kinds(since(b, &cursor)), ",")
	if want := "init,join,join,start,switch,switch,turn,request"; got != want {
		t.Fatalf("opening events = %s, want %s", got, want)
	}
}

func TestSuperEffectiveMoveReportsEffectivenessAndCanWin(t *testing.T) {
	p1 := []Creature{creature("a", "emberfox", 100, []string{"Fire"}, mv("flare", "Fire", 120, 10))}
	p1[0].Speed = 200
	b := newAI(t, p1, []Creature{creature("b", "mossling", 10, []string{"Grass"}, mv("vine", "Grass", 40, 10))}, 7)
	cursor := 0
	since(b, &cursor)
	must(t, b.SubmitChoice("p1", move0()))
	events := since(b, &cursor)
	if dmg := find(events, "damage"); dmg == nil || dmg["effectiveness"] != "super" {
		t.Fatalf("expected a super-effective hit, got %v", kinds(events))
	}
	if win := find(events, "win"); win == nil || win["winner"] != "p1" {
		t.Fatalf("expected p1 to win, got %v", kinds(events))
	}
}

func TestMoveDecrementsPP(t *testing.T) {
	b := newAI(t,
		[]Creature{creature("a", "emberfox", 100, []string{"Fire"}, mv("ember", "Fire", 40, 5))},
		[]Creature{creature("b", "tidecub", 100, []string{"Water"}, mv("splash", "Water", 40, 5))}, 3)
	cursor := 0
	since(b, &cursor)
	must(t, b.SubmitChoice("p1", move0()))
	for _, e := range since(b, &cursor) {
		if e["type"] == "move" && e["side"] == "p1" {
			if e["ppLeft"] != 4 {
				t.Fatalf("expected 4 PP left, got %v", e["ppLeft"])
			}
			return
		}
	}
	t.Fatal("no p1 move event found")
}

func TestRejectsIllegalChoices(t *testing.T) {
	b := newAI(t,
		[]Creature{creature("a", "emberfox", 100, []string{"Fire"}, mv("ember", "Fire", 40, 5))},
		[]Creature{creature("b", "tidecub", 100, []string{"Water"}, mv("splash", "Water", 40, 5))}, 1)
	if err := b.SubmitChoice("p1", Choice{Kind: "switch", TeamIndex: 0}); err == nil {
		t.Fatal("expected error switching to the active creature")
	}
	if err := b.SubmitChoice("p1", Choice{Kind: "move", MoveIndex: 9}); err == nil {
		t.Fatal("expected error for an out-of-range move")
	}
	must(t, b.SubmitChoice("p1", move0()))
}

func TestRejectsChoiceAfterBattleEnds(t *testing.T) {
	p1 := []Creature{creature("a", "emberfox", 100, []string{"Fire"}, mv("flare", "Fire", 120, 10))}
	p1[0].Speed = 200
	b := newAI(t, p1, []Creature{creature("b", "mossling", 10, []string{"Grass"}, mv("vine", "Grass", 40, 10))}, 2)
	must(t, b.SubmitChoice("p1", move0()))
	if !b.Over() {
		t.Fatal("expected the battle to be over")
	}
	if err := b.SubmitChoice("p1", move0()); !errors.Is(err, ErrFinished) {
		t.Fatalf("expected ErrFinished, got %v", err)
	}
}

func TestDeterministicForSameSeedAndChoices(t *testing.T) {
	play := func() string {
		b := newAI(t,
			[]Creature{creature("a", "emberfox", 200, []string{"Fire"}, mv("ember", "Fire", 40, 10))},
			[]Creature{creature("b", "tidecub", 200, []string{"Water"}, mv("splash", "Water", 40, 10))}, 42)
		for i := 0; i < 3 && !b.Over(); i++ {
			must(t, b.SubmitChoice("p1", move0()))
		}
		log, _ := b.EventsSince(0)
		out, _ := json.Marshal(log)
		return string(out)
	}
	if play() != play() {
		t.Fatal("same seed and choices produced different battles")
	}
}

func TestSwitchToBenchCreature(t *testing.T) {
	p1 := []Creature{
		creature("lead", "emberfox", 100, []string{"Fire"}, mv("ember", "Fire", 40, 10)),
		creature("bench", "tidecub", 100, []string{"Water"}, mv("splash", "Water", 40, 10)),
	}
	b := newAI(t, p1, []Creature{creature("b", "mossling", 100, []string{"Grass"}, mv("vine", "Grass", 40, 10))}, 5)
	cursor := 0
	since(b, &cursor)
	must(t, b.SubmitChoice("p1", Choice{Kind: "switch", TeamIndex: 1}))
	sw := find(since(b, &cursor), "switch")
	if sw == nil || sw["side"] != "p1" || sw["teamIndex"] != 1 {
		t.Fatalf("expected a switch to bench index 1, got %v", sw)
	}
}

func TestSpentMovesBecomeStruggle(t *testing.T) {
	lead := creature("a", "emberfox", 200, []string{"Fire"}, mv("ember", "Fire", 40, 1))
	b := newAI(t, []Creature{lead}, []Creature{creature("b", "tidecub", 200, []string{"Water"}, mv("splash", "Water", 10, 10))}, 9)
	must(t, b.SubmitChoice("p1", move0())) // spends the only PP
	if got := b.active("p1").Moves[0].ID; got != "struggle" {
		t.Fatalf("expected explicit Struggle, got %s", got)
	}
	hp := b.active("p1").HP
	if err := b.SubmitChoice("p1", move0()); err != nil {
		t.Fatal(err)
	}
	if b.active("p1").HP > hp-50 {
		t.Fatal("Struggle must apply quarter-max-HP recoil")
	}

}

func TestAITimeoutResolvesExactlyOneTurn(t *testing.T) {
	b := newAI(t,
		[]Creature{creature("a", "emberfox", 200, []string{"Fire"}, mv("ember", "Fire", 40, 10))},
		[]Creature{creature("b", "tidecub", 200, []string{"Water"}, mv("splash", "Water", 40, 10))}, 4)
	b.SetTimer("p1", true)
	b.deadline = time.Now().Add(-time.Second)
	if !b.ApplyTimeout(time.Now()) {
		t.Fatal("timeout did not act")
	}
	if b.turn != 2 {
		t.Fatalf("expected exactly one resolved turn, now on turn %d", b.turn)
	}
}

// ── Two players (PvP) ──

func TestPvPWaitsForBothTeams(t *testing.T) {
	b, err := New("B3", Config{Mode: ModePvP, You: you, Opponent: opp})
	must(t, err)
	if err := b.SubmitChoice("p1", move0()); !errors.Is(err, ErrNotStarted) {
		t.Fatalf("expected ErrNotStarted before teams, got %v", err)
	}
	must(t, b.SetTeam("p1", []Creature{{SpriteID: "charmander"}}, Format{}))
	if b.Started() {
		t.Fatal("battle started with only one team")
	}
	ai := newAI(t,
		[]Creature{creature("a", "emberfox", 100, []string{"Fire"}, mv("ember", "Fire", 40, 10))},
		[]Creature{creature("b", "mossling", 100, []string{"Grass"}, mv("vine", "Grass", 40, 10))}, 1)
	if err := ai.SetTeam("p2", nil, Format{}); !errors.Is(err, ErrWrongMode) {
		t.Fatalf("expected ErrWrongMode for SetTeam on an AI battle, got %v", err)
	}
}

func TestPvPHidesChoiceUntilBothSubmit(t *testing.T) {
	b := newPvP(t,
		[]Creature{creature("a", "emberfox", 200, []string{"Fire"}, mv("ember", "Fire", 40, 10))},
		[]Creature{creature("b", "tidecub", 200, []string{"Water"}, mv("splash", "Water", 40, 10))}, 11)
	cursor := 0
	since(b, &cursor)

	must(t, b.SubmitChoice("p1", move0()))
	if leaked := since(b, &cursor); len(leaked) != 0 {
		t.Fatalf("p1's choice leaked into the shared log: %v", kinds(leaked))
	}
	if err := b.SubmitChoice("p1", move0()); !errors.Is(err, ErrNotYourTurn) {
		t.Fatalf("expected ErrNotYourTurn for a second lock-in, got %v", err)
	}

	must(t, b.SubmitChoice("p2", move0()))
	moved := map[any]bool{}
	for _, e := range since(b, &cursor) {
		if e["type"] == "move" {
			moved[e["side"]] = true
		}
	}
	if !moved["p1"] || !moved["p2"] {
		t.Fatalf("expected both sides to act once both chose, got %v", moved)
	}
}

func TestPvPForcedSwitchTargetsTheFaintedSide(t *testing.T) {
	p1 := []Creature{
		creature("lead", "magikarp", 5, []string{"Water"}, mv("tackle", "Normal", 10, 20)),
		creature("bench", "gyarados", 200, []string{"Water"}, mv("crunch", "Dark", 40, 20)),
	}
	p2 := []Creature{creature("foe", "zapdos", 200, []string{"Electric"}, mv("bolt", "Electric", 90, 20))}
	p2[0].Speed = 200
	b := newPvP(t, p1, p2, 13)
	cursor := 0
	since(b, &cursor)

	must(t, b.SubmitChoice("p1", move0()))
	must(t, b.SubmitChoice("p2", move0()))
	events := since(b, &cursor)
	last := events[len(events)-1]
	if last["type"] != "request" || last["phase"] != "switching" || last["side"] != "p1" {
		t.Fatalf("expected a switching request for p1, got %v", last)
	}
	if err := b.SubmitChoice("p2", move0()); !errors.Is(err, ErrNotYourTurn) {
		t.Fatalf("p2 must wait while p1 switches, got %v", err)
	}
	must(t, b.SubmitChoice("p1", Choice{Kind: "switch", TeamIndex: 1}))
	if got := strings.Join(kinds(since(b, &cursor)), ","); !strings.HasPrefix(got, "resolving,switch,turn") {
		t.Fatalf("unexpected forced-switch events: %s", got)
	}
}

func TestPvPTimeoutAutoPlaysOnlyTheStallingSide(t *testing.T) {
	b := newPvP(t,
		[]Creature{creature("a", "emberfox", 200, []string{"Fire"}, mv("ember", "Fire", 40, 10))},
		[]Creature{creature("b", "tidecub", 200, []string{"Water"}, mv("splash", "Water", 40, 10))}, 17)
	cursor := 0
	since(b, &cursor)
	must(t, b.SubmitChoice("p1", move0()))

	if b.ApplyTimeout(time.Now()) {
		t.Fatal("timeout fired before the deadline")
	}
	b.deadline = time.Now().Add(-time.Second)
	if !b.ApplyTimeout(time.Now()) {
		t.Fatal("timeout did not act")
	}
	events := since(b, &cursor)
	note := find(events, "chat")
	if note == nil || !strings.HasPrefix(note["text"].(string), "Opp ran out of time") {
		t.Fatalf("expected a timeout note for the stalling player, got %v", note)
	}
	if b.turn != 2 {
		t.Fatalf("timeout should resolve the turn, now on turn %d", b.turn)
	}
}
