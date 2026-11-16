package arena

import "math"

func (g *Game) Step() {
	if g.Fighters[1] == nil || g.Winner != "" {
		return
	}
	g.Tick++
	for i, f := range g.Fighters {
		if f.pendingSpecial {
			continue
		}
		in := g.Inputs[i]
		length := math.Hypot(in.DX, in.DY)
		if length > 1 {
			in.DX /= length
			in.DY /= length
		}
		if in.Dodge && !f.dodgeHeld && g.Tick >= f.dodgeReady {
			if length < 0.01 {
				awayX, awayY := f.X-g.Fighters[1-i].X, f.Y-g.Fighters[1-i].Y
				awayLength := math.Hypot(awayX, awayY)
				if awayLength > 0 {
					in.DX, in.DY = awayX/awayLength, awayY/awayLength
				} else {
					in.DX = 1
				}
			}
			f.X += in.DX * 90
			f.Y += in.DY * 90
			f.dodgeUntil = g.Tick + DodgeInvulnerableTicks
			f.dodgeReady = g.Tick + DodgeCooldownTicks
		}
		f.dodgeHeld = in.Dodge
		f.X = math.Max(28, math.Min(Width-28, f.X+in.DX*f.Card.Speed*TickMs/1000))
		f.Y = math.Max(28, math.Min(Height-28, f.Y+in.DY*f.Card.Speed*TickMs/1000))
	}
	var damage [2]int
	for i, f := range g.Fighters {
		if f.HP <= 0 {
			continue
		}
		in := g.Inputs[i]
		move := Move{}
		kind := ""
		if f.pendingSpecial {
			if g.Tick < f.chargeEndTick {
				f.specialHeld = in.Special
				continue
			}
			move, kind = f.Card.Special, "special"
			f.pendingSpecial = false
		} else if in.Special && !f.specialHeld && f.Energy >= SpecialCost && g.Tick >= f.specialReady {
			f.pendingSpecial = true
			f.chargeEndTick = g.Tick + SpecialWindupTicks
			f.ChargeX, f.ChargeY = f.X, f.Y
			target := g.Fighters[1-i]
			f.ChargeDX, f.ChargeDY = aimDirection(in, f.X, f.Y, target.X, target.Y)
			f.specialReady = g.Tick + (f.Card.Special.CooldownMs+TickMs-1)/TickMs
			f.Energy -= SpecialCost
			f.specialHeld = true
			continue
		} else if in.Basic && g.Tick >= f.basicReady {
			move, kind = f.Card.Basic, "basic"
			f.basicReady = g.Tick + (move.CooldownMs+TickMs-1)/TickMs
		}
		f.specialHeld = in.Special
		if kind == "" {
			continue
		}
		target := g.Fighters[1-i]
		sourceX, sourceY := f.X, f.Y
		if kind == "special" {
			sourceX, sourceY = f.ChargeX, f.ChargeY
		}
		targetDX, targetDY := target.X-sourceX, target.Y-sourceY
		distance := math.Hypot(targetDX, targetDY)
		aimX, aimY := aimDirection(in, sourceX, sourceY, target.X, target.Y)
		if kind == "special" {
			aimX, aimY = f.ChargeDX, f.ChargeDY
		}
		hit := distance <= move.Range
		if move.Shape == ShapeCone && distance > 0 {
			// A cone special only reaches targets within ConeHalfAngle of the aim.
			hit = hit && (aimX*targetDX+aimY*targetDY)/distance >= math.Cos(ConeHalfAngle*math.Pi/180)
		}
		dealt := 0
		if hit {
			dealt = hitDamage(f.Card, move, target.Card)
			hit = dealt > 0 // an immune target shrugs the move off
		}
		f.LastAttack, f.LastAttackTick = kind, g.Tick
		f.AttackX, f.AttackY = sourceX, sourceY
		f.AttackDX, f.AttackDY = aimX, aimY
		f.AttackTargetX, f.AttackTargetY = target.X, target.Y
		f.LastAttackHit = hit
		if hit && g.Tick >= target.dodgeUntil {
			damage[1-i] += dealt
			if move.ID == "struggle" {
				damage[i] += max(1, f.Card.MaxHP/4)
			}
			if kind == "basic" {
				f.Energy = min(MaxEnergy, f.Energy+1)
			}
		} else if hit {
			f.LastAttackHit = false
		}
	}
	for i, f := range g.Fighters {
		f.HP = max(0, f.HP-damage[i])
	}
	if g.Fighters[0].HP == 0 && g.Fighters[1].HP == 0 {
		g.Winner = "draw"
	}
	if g.Fighters[0].HP == 0 && g.Fighters[1].HP > 0 {
		g.Winner = "player2"
	}
	if g.Fighters[1].HP == 0 && g.Fighters[0].HP > 0 {
		g.Winner = "player1"
	}
	if g.Tick >= MatchTicks && g.Winner == "" {
		a, b := g.Fighters[0], g.Fighters[1]
		difference := a.HP*b.Card.MaxHP - b.HP*a.Card.MaxHP
		if difference > 0 {
			g.Winner = "player1"
		} else if difference < 0 {
			g.Winner = "player2"
		} else {
			g.Winner = "draw"
		}
	}
	g.Frames = append(g.Frames, g.ReplayFrame())
}

func aimDirection(in Input, sourceX, sourceY, targetX, targetY float64) (float64, float64) {
	if length := math.Hypot(in.AimX, in.AimY); length > 0.01 {
		return in.AimX / length, in.AimY / length
	}
	dx, dy := targetX-sourceX, targetY-sourceY
	if length := math.Hypot(dx, dy); length > 0 {
		return dx / length, dy / length
	}
	return 1, 0
}
