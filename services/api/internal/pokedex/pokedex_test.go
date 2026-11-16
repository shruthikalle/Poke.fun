package pokedex

import (
	"encoding/json"
	"os"
	"testing"
)

func TestEveryCatalogCardResolvesToAKnownSpecies(t *testing.T) {
	if len(db.Cards.Entries) == 0 || len(All()) == 0 {
		t.Fatal("pokedex.json is empty")
	}
	for _, c := range db.Cards.Entries {
		if _, ok := Lookup(c.Species); !ok {
			t.Errorf("card %s maps to %q, which is not in the pokedex", c.ID, c.Species)
		}
	}
}

func TestSpeciesData(t *testing.T) {
	for _, s := range All() {
		if s.Name == "" || s.Dex == 0 || len(s.Types) == 0 || s.Base.HP == 0 || s.Sprite == "" {
			t.Errorf("%s is missing basic data: %+v", s.Key, s)
		}
		if s.Tier < 1 || s.Tier > 3 {
			t.Errorf("%s has tier %d", s.Key, s.Tier)
		}
		for _, m := range append(s.LevelUpMoves(), s.OtherLearnableMoves()...) {
			if m.Power <= 0 || (m.Category != "physical" && m.Category != "special") {
				t.Errorf("%s learns a non-damaging move %+v", s.Key, m)
			}
		}
	}
}

func TestPikachuMatchesPokeAPI(t *testing.T) {
	p, ok := Lookup("pikachu")
	if !ok {
		t.Fatal("pikachu missing")
	}
	if p.Dex != 25 || p.Types[0] != "Electric" || p.Base.Spe != 90 || p.Tier != 1 {
		t.Fatalf("unexpected pikachu: %+v", p)
	}
	learns := map[string]bool{}
	for _, m := range p.LevelUpMoves() {
		learns[m.ID] = true
	}
	if !learns["thunderbolt"] || !learns["quick-attack"] {
		t.Fatal("pikachu should learn Thunderbolt and Quick Attack by level-up")
	}
	// Level-50 stats, the same numbers the devnet powers log reports.
	if got := p.StatsAt(50); got.HP != 110 || got.Atk != 75 || got.SpA != 70 {
		t.Fatalf("pikachu level-50 stats = %+v", got)
	}
}

func TestTiersSkipBabyStages(t *testing.T) {
	for key, want := range map[string]int{"pikachu": 1, "raichu": 2, "charizard": 3, "mr-mime": 1, "mewtwo": 3} {
		if s, _ := Lookup(key); s.Tier != want {
			t.Errorf("%s tier = %d, want %d", key, s.Tier, want)
		}
	}
}

func TestSpeciesForCard(t *testing.T) {
	cases := []struct{ set, number, want string }{
		{"Base Set", "58", "pikachu"},
		{"base set", "58/102", "pikachu"}, // case and "number/total" form
		{"Base", "4", "charizard"},        // set alias
		{"Nope", "58", ""},
	}
	for _, c := range cases {
		if got, _ := SpeciesForCard(c.set, c.number); got != c.want {
			t.Errorf("SpeciesForCard(%q, %q) = %q, want %q", c.set, c.number, got, c.want)
		}
	}
}

func TestEveryPokemonIsIncluded(t *testing.T) {
	defaults := map[string]int{}
	dex := map[int]bool{}
	for _, s := range All() {
		dex[s.Dex] = true
		if s.Default {
			defaults[s.Species]++
		}
	}
	for n := 1; n <= 1025; n++ {
		if !dex[n] {
			t.Errorf("National Dex #%d is missing", n)
		}
	}
	for species, count := range defaults {
		if count != 1 {
			t.Errorf("%s has %d default forms", species, count)
		}
	}
	for _, key := range []string{"charizard-mega-x", "charizard-gmax", "vulpix-alola", "zoroark-hisui", "groudon-primal"} {
		if _, ok := Lookup(key); !ok {
			t.Errorf("card form %s is missing", key)
		}
	}
}

// The shared cases are also the spec for the browser's copy of the resolver
// (apps/web/lib/cards/cardNames.ts).
func TestSpeciesForCardName(t *testing.T) {
	raw, err := os.ReadFile("testdata/card_names.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Name, Species string }
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if got, _ := SpeciesForCardName(c.Name); got != c.Species {
			t.Errorf("SpeciesForCardName(%q) = %q, want %q", c.Name, got, c.Species)
		}
	}
}
