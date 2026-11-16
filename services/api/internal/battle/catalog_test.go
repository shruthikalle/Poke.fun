package battle

import (
	"errors"
	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
	"testing"
	"time"
)

func realDuel(t *testing.T, a, b string) *Match {
	t.Helper()
	m, err := NewMatch("REAL", "Alice", a, "a")
	if err != nil {
		t.Fatal(err)
	}
	if err = m.Join("Bob", b, "b"); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestAll1214RealDuelCards(t *testing.T) {
	if len(Cards()) != 1214 || len(Cards()) != len(pokedex.All()) {
		t.Fatalf("cards=%d", len(Cards()))
	}
	seen := map[string]bool{}
	for _, c := range Cards() {
		s, ok := pokedex.Lookup(c.ID)
		if !ok || seen[c.ID] || c.Name != s.Name || c.MaxHP != s.StatsAt(50).HP || c.Stats != s.StatsAt(50) || c.Level != 50 || len(c.Types) != len(s.Types) {
			t.Fatalf("invalid card %+v", c)
		}
		seen[c.ID] = true
		legal := map[string]bool{}
		for _, m := range append(s.LevelUpMoves(), s.OtherLearnableMoves()...) {
			legal[m.ID] = true
		}
		if len(c.Attacks) < 1 || len(c.Attacks) > 2 {
			t.Fatalf("%s attacks=%d", c.ID, len(c.Attacks))
		}
		used := map[string]bool{}
		for i, a := range c.Attacks {
			if used[a.ID] || a.Power <= 0 || a.Damage <= 0 || (a.ID != "struggle" && !legal[a.ID]) {
				t.Fatalf("%s illegal attack %+v", c.ID, a)
			}
			if a.ID == "struggle" && len(legal) != 0 {
				t.Fatalf("%s unnecessary Struggle", c.ID)
			}
			if (i == 0 && (a.Cost != 0 || a.Gain != 1)) || (i == 1 && (a.Cost != 2 || a.Gain != 0)) {
				t.Fatalf("%s energy %+v", c.ID, a)
			}
			used[a.ID] = true
		}
	}
	for _, id := range []string{"emberfox", "tidecub", "mossling"} {
		if _, ok := FindCard(id); ok {
			t.Fatalf("active fictional alias %s", id)
		}
	}
}

func TestRealDuelEnergySimultaneousAndTimeout(t *testing.T) {
	m := realDuel(t, "charmander", "squirtle")
	quick, heavy := m.Players[0].Card.Attacks[0], m.Players[0].Card.Attacks[1]
	if err := m.Submit(0, heavy.ID); !errors.Is(err, ErrInvalidAttack) {
		t.Fatal("unaffordable heavy accepted")
	}
	if err := m.Submit(0, quick.ID); err != nil {
		t.Fatal(err)
	}
	if m.Players[1].HP != m.Players[1].Card.MaxHP {
		t.Fatal("early resolution")
	}
	m.Deadline = time.Now().Add(-time.Second)
	if !m.ApplyTimeout(time.Now()) || m.History[0].Auto != [2]bool{false, true} || m.Players[0].Energy != 1 || m.Players[1].Energy != 1 {
		t.Fatal("timeout/energy")
	}
	m.Players[0].Energy = 2
	_ = m.Submit(0, heavy.ID)
	_ = m.Submit(1, m.Players[1].Card.Attacks[0].ID)
	if m.Players[0].Energy != 0 {
		t.Fatal("heavy cost")
	}
	if err := m.Submit(-1, quick.ID); !errors.Is(err, ErrInvalidAttack) {
		t.Fatal("invalid index")
	}
	for n := 0; n < 200 && m.Winner == ""; n++ {
		for i, p := range m.Players {
			if err := m.Submit(i, autoAttack(p)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if m.Winner == "" {
		t.Fatal("match never finished")
	}
}

func TestRealDuelDamageAndStruggle(t *testing.T) {
	m := realDuel(t, "pikachu", "gyarados")
	a := Attack{ID: "thunderbolt", Element: "Electric", Category: "special", Power: 90}
	damage, effect := attackDamage(m.Players[0], m.Players[1], a)
	// Level50 70 SpA vs 120 SpD; Electric STAB and 4x Water/Flying.
	if damage < 82 || damage > 84 || effect != "super" {
		t.Fatalf("damage %d effect %s", damage, effect)
	}
	m.Players[1].Card, _ = FindCard("onix")
	if damage, effect = attackDamage(m.Players[0], m.Players[1], a); damage != 0 || effect != "immune" {
		t.Fatal("Ground immunity")
	}
	m = realDuel(t, "ditto", "gengar")
	if len(m.Players[0].Card.Attacks) != 1 || m.Players[0].Card.Attacks[0].ID != "struggle" {
		t.Fatal("fictional Ditto moves")
	}
	before := m.Players[0].HP
	_ = m.Submit(0, "struggle")
	_ = m.Submit(1, m.Players[1].Card.Attacks[0].ID)
	turn := m.History[0]
	if turn.Damage[0] <= 0 || turn.Effect[0] != "normal" || m.Players[0].HP != max(0, before-turn.Damage[1]-max(1, m.Players[0].Card.MaxHP/4)) {
		t.Fatalf("Struggle %+v", turn)
	}
	m = realDuel(t, "ditto", "ditto")
	for _, p := range m.Players {
		p.HP = 1
	}
	_ = m.Submit(0, "struggle")
	_ = m.Submit(1, "struggle")
	if m.Winner != "draw" || !m.Deadline.IsZero() {
		t.Fatal("simultaneous recoil knockout")
	}
}

func TestRealDuelNamesAndVersions(t *testing.T) {
	for _, name := range []string{"", "  ", "a\nb", "1234567890123456789012345", "ééééééééééééé"} {
		if _, err := NewMatch("ID", name, "pikachu", "t"); !errors.Is(err, ErrInvalidName) {
			t.Fatalf("invalid name %q accepted", name)
		}
	}
	m, err := NewMatch("ID", " Alice ", "pikachu", "a")
	if err != nil {
		t.Fatal(err)
	}
	if err = m.Join("aLiCe ", "charmander", "b"); !errors.Is(err, ErrSameName) {
		t.Fatal("same name accepted")
	}
	if m.Players[1] != nil {
		t.Fatal("invalid join mutated match")
	}
	if m.Players[0].Name != "Alice" || m.RulesVersion != RulesVersion || m.CatalogVersion != pokedex.Version() {
		t.Fatal("canonical name/version")
	}
}
