package arena

import (
	"sort"
	"testing"

	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

func fighter(t *testing.T, id string) Card {
	t.Helper()
	c, ok := FindCard(id)
	if !ok {
		t.Fatalf("%s is not a fighter", id)
	}
	return c
}

func TestEverySpeciesIsAValidFighter(t *testing.T) {
	if len(Cards()) != len(pokedex.All()) {
		t.Fatalf("%d fighters for %d species", len(Cards()), len(pokedex.All()))
	}
	for _, c := range Cards() {
		switch {
		case c.MaxHP <= 0, c.Speed < 170, c.Speed > 300, c.Tier < 1, c.Tier > 3, c.Sprite == "":
			t.Errorf("%s has invalid stats: %+v", c.ID, c)
		case c.Basic.Power != basicPower || c.Basic.Range != BasicRange || c.Basic.Damage < 1 || c.Basic.CooldownMs < 400:
			t.Errorf("%s has an invalid basic move: %+v", c.ID, c.Basic)
		case c.Special.Power <= 0 || c.Special.Damage < 1 || c.Special.Shape == "" || c.Special.CooldownMs < 3500:
			t.Errorf("%s has an invalid special move: %+v", c.ID, c.Special)
		case unusable[c.Basic.ID] || unusable[c.Special.ID] || c.Basic.ID == c.Special.ID:
			t.Errorf("%s picked an unusable or duplicate move: %s / %s", c.ID, c.Basic.ID, c.Special.ID)
		}
	}
}

// Pins the calibration against the original hand-tuned fighters, so changing
// the formula is a deliberate, reviewed decision.
func TestOriginalFightersKeepTheirFeel(t *testing.T) {
	pikachu, charmander := fighter(t, "pikachu"), fighter(t, "charmander")
	if pikachu.Basic.Name != "Quick Attack" || pikachu.Special.Name != "Thunderbolt" || pikachu.Special.Shape != ShapeRadius {
		t.Errorf("pikachu moves: %s / %s (%s)", pikachu.Basic.Name, pikachu.Special.Name, pikachu.Special.Shape)
	}
	if charmander.Basic.Name != "Scratch" || charmander.Special.Name != "Flamethrower" || charmander.Special.Shape != ShapeCone {
		t.Errorf("charmander moves: %s / %s (%s)", charmander.Basic.Name, charmander.Special.Name, charmander.Special.Shape)
	}
	if pikachu.Speed != 250 || pikachu.Basic.CooldownMs != 450 || pikachu.Special.CooldownMs != 4500 {
		t.Errorf("pikachu pace: speed %.0f, cooldowns %d / %d", pikachu.Speed, pikachu.Basic.CooldownMs, pikachu.Special.CooldownMs)
	}
	if got := hitDamage(pikachu, pikachu.Special, charmander); got != 26 {
		t.Errorf("thunderbolt on charmander = %d, want 26 (the hand-tuned value)", got)
	}
	if got := hitDamage(charmander, charmander.Special, pikachu); got < 28 || got > 31 {
		t.Errorf("flamethrower on pikachu = %d, want about 29", got)
	}
}

func TestSpecialsUseTypeMatchupsButBasicsDoNot(t *testing.T) {
	pikachu := fighter(t, "pikachu")
	neutral := hitDamage(pikachu, pikachu.Special, fighter(t, "charmander"))
	if got := hitDamage(pikachu, pikachu.Special, fighter(t, "onix")); got != 0 {
		t.Errorf("electric special on Rock/Ground Onix = %d, want 0 (immune)", got)
	}
	if got := hitDamage(pikachu, pikachu.Special, fighter(t, "gyarados")); got < 2*neutral {
		t.Errorf("electric special on Water/Flying Gyarados = %d, want at least 2x the neutral %d", got, neutral)
	}
	// A Normal-type basic would do nothing to a Ghost; basics are typeless so a
	// player can always build energy.
	if got := hitDamage(pikachu, pikachu.Basic, fighter(t, "gengar")); got < 1 {
		t.Errorf("basic on Gengar = %d, want chip damage", got)
	}
}

func TestMovePicksFollowTheSpecies(t *testing.T) {
	if c := fighter(t, "geodude"); c.Special.Type != "Ground" && c.Special.Type != "Rock" {
		t.Errorf("geodude special %s (%s): want a strong same-type move, not a weak special", c.Special.Name, c.Special.Type)
	}
	if c := fighter(t, "gyarados"); c.Special.Category != "physical" {
		t.Errorf("physical attacker gyarados picked %s (%s)", c.Special.Name, c.Special.Category)
	}
	if c := fighter(t, "abra"); c.Basic.Category != "special" || c.Special.Type != "Psychic" {
		t.Errorf("abra (no damaging level-up moves) picked %s / %s", c.Basic.Name, c.Special.Name)
	}
	if c := fighter(t, "ditto"); c.Basic.ID != "tackle" || c.Special.ID != "body-slam" {
		t.Errorf("moveless ditto should use the fallback moves, got %s / %s", c.Basic.ID, c.Special.ID)
	}
}

// Fighters are only matched within a tier, so within each tier the time to
// knock out an average opponent with basics alone should be in the same range.
func TestTiersAreRoughlyBalanced(t *testing.T) {
	byTier := map[int][]Card{}
	for _, c := range Cards() {
		byTier[c.Tier] = append(byTier[c.Tier], c)
	}
	for tier, cards := range byTier {
		var seconds []float64
		for _, a := range cards {
			for _, d := range cards {
				seconds = append(seconds, float64(d.MaxHP)/float64(hitDamage(a, a.Basic, d))*float64(a.Basic.CooldownMs)/1000)
			}
		}
		sort.Float64s(seconds)
		if median := seconds[len(seconds)/2]; median < 5 || median > 10 {
			t.Errorf("tier %d: median basic-only knockout takes %.1fs, want 5-10s", tier, median)
		}
	}
}
