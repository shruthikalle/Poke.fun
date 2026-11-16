package arena

import "testing"

func TestForfeitEndsOnlyAnActiveMatch(t *testing.T) {
	game, err := New("test", "Alice", "pikachu", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if err := game.Forfeit(0); err == nil {
		t.Fatal("a waiting match cannot be forfeited")
	}
	if err := game.Join("Bob", "charmander", "bob"); err != nil {
		t.Fatal(err)
	}
	if err := game.Forfeit(-1); err == nil {
		t.Fatal("invalid side accepted")
	}
	game.SetInput(0, Input{Basic: true})
	if err := game.Forfeit(0); err != nil {
		t.Fatal(err)
	}
	if game.Winner != "player2" || game.Inputs != [2]Input{} {
		t.Fatal("forfeit must award the opponent and clear held inputs")
	}
	if err := game.Forfeit(1); err == nil || game.Winner != "player2" {
		t.Fatal("a second forfeit changed the result")
	}
	previousTick := game.Tick
	game.Step()
	if game.Tick != previousTick {
		t.Fatal("a forfeited match kept advancing")
	}
}
