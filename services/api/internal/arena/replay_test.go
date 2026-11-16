package arena

import "testing"

func TestArenaReplaySurvivesCheckpoint(t *testing.T) {
	g, err := New("replay", "Alice", "pikachu", "alice-token")
	if err != nil {
		t.Fatal(err)
	}
	if err := g.Join("Bob", "bulbasaur", "bob-token"); err != nil {
		t.Fatal(err)
	}
	g.SetInput(0, Input{DX: 1, Basic: true})
	g.Step()
	g.Step()
	if len(g.Replay()) != 3 {
		t.Fatalf("expected opening and two tick frames, got %d", len(g.Replay()))
	}
	restored, err := Restore(g.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.Replay()) != 3 || restored.Replay()[2] != g.Replay()[2] {
		t.Fatal("replay changed on restart")
	}
}
