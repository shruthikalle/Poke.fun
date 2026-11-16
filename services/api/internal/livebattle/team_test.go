package livebattle

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

func TestCanonicalTeamIgnoresTamperedCombatFields(t *testing.T) {
	clean, err := CanonicalTeam([]Creature{{SpriteID: "pikachu"}}, "p1")
	must(t, err)
	tampered := Creature{SpriteID: "pikachu", Species: "Mewtwo", Level: 999, Speed: 999999, HP: 999999, MaxHP: 999999,
		Stats: Stats{Atk: 999999, Def: 0, Spa: 999999, Spd: 0}, Types: []string{"Dragon"}, Fainted: true,
		Moves: []Move{{ID: "explosion", Power: 999999, PP: 999999, MaxPP: 999999}}}
	actual, err := CanonicalTeam([]Creature{tampered}, "p1")
	must(t, err)
	if !reflect.DeepEqual(clean, actual) {
		t.Fatalf("client combat definitions trusted: %+v", actual)
	}
	// Constructor also enforces canonicalization (not just the helper).
	b, err := New("canonical", Config{Mode: ModeAI, Teams: map[string][]Creature{"p1": {tampered}, "p2": {{SpriteID: "ditto"}}}})
	must(t, err)
	if !reflect.DeepEqual(*b.active("p1"), clean[0]) {
		t.Fatal("New bypassed canonical team construction")
	}
}

func TestEffectStateSurvivesRestart(t *testing.T) {
	b, err := New("effects-restart", Config{Mode: ModeAI, You: Trainer{Name: "Alice"}, Opponent: Trainer{Name: "Bot"},
		Teams: map[string][]Creature{"p1": {{SpriteID: "pikachu"}}, "p2": {{SpriteID: "bulbasaur"}}}, Seed: 17})
	must(t, err)
	c := b.active("p1")
	c.Status, c.StatusTurns, c.Confused = "toxic", 4, 2
	c.Boosts.Atk = 3
	b.weather, b.weatherTurns = "rain", 3
	restored, err := Restore(b.Snapshot())
	must(t, err)
	got := restored.active("p1")
	if got.Status != "toxic" || got.StatusTurns != 4 || got.Confused != 2 || got.Boosts.Atk != 3 || restored.weather != "rain" || restored.weatherTurns != 3 {
		t.Fatalf("effect state changed on restart: %+v weather=%s/%d", got, restored.weather, restored.weatherTurns)
	}
}

func TestForfeitSurvivesRestart(t *testing.T) {
	b, err := New("forfeit-restart", Config{Mode: ModeAI, You: Trainer{Name: "Alice"}, Opponent: Trainer{Name: "Bot"},
		Teams: map[string][]Creature{"p1": {{SpriteID: "pikachu"}}, "p2": {{SpriteID: "bulbasaur"}}}, Seed: 18})
	must(t, err)
	must(t, b.Forfeit("p1"))
	restored, err := Restore(b.Snapshot())
	must(t, err)
	if winner, over := restored.Result(); !over || winner != "p2" || restored.ResultReason() != "forfeit" {
		t.Fatal("forfeit result changed on restart")
	}
}

func TestCanonicalTeamRejectsUnknownAndDuplicateBaseSpecies(t *testing.T) {
	for _, team := range [][]Creature{
		nil, {{SpriteID: "not-a-pokemon"}}, {{SpriteID: "pikachu"}, {SpriteID: "pikachu"}},
		{{SpriteID: "charizard"}, {SpriteID: "charizard-mega-x"}},
	} {
		if _, err := CanonicalTeam(team, "p1"); err == nil {
			t.Fatalf("invalid team accepted: %+v", team)
		}
	}
}

func TestEveryCanonicalMoveIsLearnable(t *testing.T) {
	for _, s := range pokedex.All() {
		allowed := map[string]bool{}
		for _, m := range s.LearnableMoves() {
			allowed[m.ID] = true
		}
		moves := SpeciesMoves(s)
		if len(moves) < 1 || len(moves) > 4 {
			t.Fatalf("invalid move count: %s", s.Key)
		}
		for _, m := range moves {
			if !allowed[m.ID] && !(m.ID == "struggle" && len(s.TeamMoveList()) == 0) {
				t.Errorf("%s cannot learn %s", s.Key, m.ID)
			}
			if m.Category != "status" && m.Power <= 0 || m.MaxPP <= 0 {
				t.Errorf("invalid move: %+v", m)
			}
		}
	}
}

func TestStruggleIsTypelessWithoutSTABAndAppliesRecoil(t *testing.T) {
	b := newAI(t, []Creature{creature("a", "ditto", 200, []string{"Normal"}, Struggle())},
		[]Creature{creature("b", "gastly", 200, []string{"Ghost"}, mv("ghost", "Ghost", 1, 10))}, 91)
	before := b.active("p1").HP
	events := b.performMove("p1", 0)
	if b.active("p2").HP >= 200 {
		t.Fatal("Ghost incorrectly immune to Struggle")
	}
	if b.active("p1").HP != before-50 {
		t.Fatal("expected quarter-max-HP recoil")
	}
	if b.active("p1").Moves[0].PP != 1 {
		t.Fatal("Struggle must remain available")
	}
	if find(events, "damage")["effectiveness"] != "normal" {
		t.Fatal("Struggle must be typeless")
	}
	// Identical dice rolls must produce identical damage regardless of typing.
	other := newAI(t, []Creature{creature("a", "ditto", 200, []string{"Water"}, Struggle())},
		[]Creature{creature("b", "gastly", 200, []string{"Rock"}, mv("rock", "Rock", 1, 10))}, 91)
	other.performMove("p1", 0)
	if b.active("p2").HP != other.active("p2").HP {
		t.Fatal("Struggle applied STAB or effectiveness")
	}
}

func TestExhaustionPublishesMoveListAndCanDoubleKO(t *testing.T) {
	b := newAI(t, []Creature{creature("a", "ditto", 100, []string{"Normal"}, mv("hit", "Normal", 1, 1))},
		[]Creature{creature("b", "gastly", 100, []string{"Ghost"}, mv("hit", "Normal", 1, 10))}, 1)
	events := b.performMove("p1", 0) // immune hit still spends PP
	if find(events, "moves") == nil || b.active("p1").Moves[0].ID != "struggle" {
		t.Fatal("missing explicit Struggle transition")
	}
	b.active("p1").HP = 25
	b.active("p2").HP = 1
	events = b.performMove("p1", 0)
	if !b.checkOver(&events) {
		t.Fatal("recoil double KO did not end match")
	}
	if winner, over := b.Result(); !over || winner != "draw" {
		t.Fatalf("expected draw: %s %v", winner, over)
	}
}

func TestOpeningEventSnapshotIsImmutable(t *testing.T) {
	b := newAI(t, []Creature{creature("a", "pikachu", 200, []string{"Electric"}, mv("hit", "Normal", 20, 5))},
		[]Creature{creature("b", "eevee", 200, []string{"Normal"}, mv("hit", "Normal", 20, 5))}, 5)
	before, _ := json.Marshal(b.log[0])
	must(t, b.SubmitChoice("p1", move0()))
	after, _ := json.Marshal(b.log[0])
	if string(before) != string(after) {
		t.Fatal("opening log mutated with live HP/PP")
	}
}

func TestLockedTeamsAndDeclaredFormat(t *testing.T) {
	b, err := New("setup", Config{Mode: ModePvP, Format: Format{Name: "champion"}})
	must(t, err)
	if err := b.SetTeam("p1", []Creature{{SpriteID: "pikachu"}, {SpriteID: "eevee"}, {SpriteID: "ditto"}}, Format{Name: "squad"}); err == nil {
		t.Fatal("client changed declared format")
	}
	must(t, b.SetTeam("p1", []Creature{{SpriteID: "pikachu"}}, Format{}))
	if err := b.SetTeam("p1", []Creature{{SpriteID: "eevee"}}, Format{}); err == nil {
		t.Fatal("locked team replaced")
	}
	must(t, b.SetTeam("p2", []Creature{{SpriteID: "eevee"}}, Format{}))
	must(t, b.SetTeam("p1", []Creature{{SpriteID: "pikachu", MaxHP: 9999}}, Format{}))
}

func TestMutualRematchStartsOneNewRound(t *testing.T) {
	b := newPvP(t, []Creature{creature("a", "pikachu", 100, []string{"Electric"}, mv("hit", "Normal", 10, 10))},
		[]Creature{creature("b", "eevee", 100, []string{"Normal"}, mv("hit", "Normal", 10, 10))}, 1)
	b.sides["p2"].Team[0].Fainted = true
	b.over = true
	must(t, b.RequestRematch("p1"))
	must(t, b.RequestRematch("p1"))
	if !b.Over() || b.Round() != 1 {
		t.Fatal("one player reset the battle")
	}
	must(t, b.RequestRematch("p2"))
	if b.Over() || b.Round() != 2 || b.active("p2").HP != 100 {
		t.Fatal("mutual rematch failed to restore teams")
	}
}
