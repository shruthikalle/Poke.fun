package arena

import "testing"

func joinedGame(t *testing.T) *Game {
	t.Helper()
	g, err := New("ROOM", "Ash", "pikachu", "a")
	if err != nil {
		t.Fatal(err)
	}
	if err := g.Join("Misty", "charmander", "b"); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestMovementAndAttackRules(t *testing.T) {
	g := joinedGame(t)
	g.SetInput(0, Input{DX: 100, DY: 100, Basic: true})
	g.Step()
	if g.Fighters[0].X <= 120 || g.Fighters[0].Y <= Height/2 {
		t.Fatal("fighter did not move")
	}
	if g.Fighters[1].HP != g.Fighters[1].Card.MaxHP {
		t.Fatal("out-of-range attack hit")
	}
	g.Fighters[0].X, g.Fighters[0].Y = 450, 270
	g.Fighters[1].X, g.Fighters[1].Y = 500, 270
	g.SetInput(0, Input{Basic: true})
	g.Step()
	if g.Fighters[1].HP != 110 {
		t.Fatal("attack ignored cooldown")
	}
	for range 8 {
		g.Step()
	}
	if g.Fighters[1].HP != 101 {
		t.Fatalf("expected 9 damage after cooldown, got %d HP", g.Fighters[1].HP)
	}
}

func TestSimultaneousKOAndViewSecrecy(t *testing.T) {
	g := joinedGame(t)
	g.Fighters[0].X, g.Fighters[1].X = 450, 500
	g.Fighters[0].HP, g.Fighters[1].HP = 11, 9
	g.SetInput(0, Input{Basic: true})
	g.SetInput(1, Input{Basic: true})
	g.Step()
	if g.Winner != "draw" {
		t.Fatalf("winner = %q", g.Winner)
	}
	view := g.ViewFor(0)
	if view.Status != "finished" || view.Fighters[0].Token != "" || view.Fighters[1].Token != "" {
		t.Fatal("view leaked token or wrong status")
	}
}

func TestTimeoutUsesHealthPercentage(t *testing.T) {
	g := joinedGame(t)
	g.Tick = MatchTicks - 1
	g.Fighters[0].HP = 48 // 50.5% of 95
	g.Fighters[1].HP = 55 // 50% of 110
	g.Step()
	if g.Winner != "player1" {
		t.Fatalf("winner = %q", g.Winner)
	}
}

func TestEnergyAndSpecial(t *testing.T) {
	g := joinedGame(t)
	g.Fighters[0].X, g.Fighters[1].X = 450, 500
	g.SetInput(0, Input{Basic: true})
	g.Step()
	if g.Fighters[0].Energy != 1 || g.Fighters[1].HP != 101 {
		t.Fatal("basic hit did not build energy")
	}
	g.Fighters[0].basicReady = 0
	g.Step()
	if g.Fighters[0].Energy != 2 {
		t.Fatal("second basic hit did not build energy")
	}
	g.SetInput(0, Input{Special: true})
	g.Step()
	if !g.ViewFor(0).Fighters[0].Charging || g.Fighters[1].HP != 92 {
		t.Fatal("special did not show a safe windup")
	}
	for range SpecialWindupTicks {
		g.Step()
	}
	if g.Fighters[0].Energy != 0 || g.Fighters[1].HP != 66 {
		t.Fatalf("special did not consume energy and hit: energy=%d hp=%d", g.Fighters[0].Energy, g.Fighters[1].HP)
	}
}

func TestDodgeAvoidsHitAndHasCooldown(t *testing.T) {
	g := joinedGame(t)
	g.Fighters[0].X, g.Fighters[1].X = 450, 460
	g.SetInput(0, Input{Basic: true})
	g.SetInput(1, Input{Dodge: true})
	g.Step()
	if g.Fighters[1].HP != 110 || g.Fighters[1].X <= 460 {
		t.Fatal("dodge did not evade and dash")
	}
	if g.Fighters[0].Energy != 0 {
		t.Fatal("dodged basic attack granted energy")
	}
	g.SetInput(0, Input{})
	g.SetInput(1, Input{})
	for range 5 {
		g.Step()
	}
	g.Fighters[0].basicReady = 0
	g.SetInput(0, Input{Basic: true})
	g.Step()
	if g.Fighters[1].HP != 101 {
		t.Fatalf("fighter stayed invulnerable after dodge: %d", g.Fighters[1].HP)
	}
	if g.ViewFor(1).Fighters[1].DodgeCooldownMs <= 0 {
		t.Fatal("dodge has no cooldown")
	}
}

func TestFlamethrowerConeAndThunderboltRadius(t *testing.T) {
	g := joinedGame(t)
	g.Fighters[0].X, g.Fighters[1].X = 450, 500
	g.Fighters[1].Energy = SpecialCost
	g.SetInput(1, Input{Special: true, AimX: 1}) // Aim away from Pikachu.
	g.Step()
	for range SpecialWindupTicks {
		g.Step()
	}
	if g.Fighters[0].HP != 95 || g.Fighters[1].LastAttackHit {
		t.Fatal("flamethrower hit outside its cone")
	}
	g = joinedGame(t)
	g.Fighters[0].X, g.Fighters[1].X = 450, 500
	g.Fighters[1].Energy = SpecialCost
	g.SetInput(1, Input{Special: true}) // Without a pointer, auto-aim.
	g.Step()
	for range SpecialWindupTicks {
		g.Step()
	}
	if g.Fighters[0].HP != 66 {
		t.Fatal("flamethrower missed inside its cone")
	}
	g = joinedGame(t)
	g.Fighters[0].Energy = SpecialCost
	g.Fighters[0].X, g.Fighters[1].X = 450, 660
	g.SetInput(0, Input{Special: true})
	g.Step()
	for range SpecialWindupTicks {
		g.Step()
	}
	if g.Fighters[1].HP != 84 {
		t.Fatal("thunderbolt did not hit inside its radius")
	}
}

func TestDodgeCanCounterSpecialWindup(t *testing.T) {
	g := joinedGame(t)
	g.Fighters[0].X, g.Fighters[1].X = 450, 500
	g.Fighters[1].Energy = SpecialCost
	g.SetInput(1, Input{Special: true})
	g.Step()
	for range SpecialWindupTicks - 1 {
		g.Step()
	}
	g.SetInput(0, Input{Dodge: true})
	g.Step()
	if g.Fighters[0].HP != 95 || g.Fighters[1].LastAttackHit {
		t.Fatal("dodge failed to counter telegraphed special")
	}
}
