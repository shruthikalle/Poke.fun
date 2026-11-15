package arena

import (
	"errors"
	"math"
)

const (
	Width                  = 960
	Height                 = 540
	TickMs                 = 50
	MatchTicks             = 1800 // 90 seconds
	MaxEnergy              = 3
	SpecialCost            = 2
	DodgeCooldownTicks     = 60
	DodgeInvulnerableTicks = 6
	SpecialWindupTicks     = 8
)

var (
	ErrCard = errors.New("unknown arena card")
	ErrFull = errors.New("arena is full")
)

type Move struct {
	Name       string  `json:"name"`
	Damage     int     `json:"damage"`
	Range      float64 `json:"range"`
	CooldownMs int     `json:"cooldownMs"`
}

type Card struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Type    string  `json:"type"`
	Level   int     `json:"level"`
	MaxHP   int     `json:"maxHp"`
	Speed   float64 `json:"speed"`
	Basic   Move    `json:"basic"`
	Special Move    `json:"special"`
}

var cards = []Card{
	{ID: "pikachu", Name: "Pikachu", Type: "Electric", Level: 50, MaxHP: 95, Speed: 250,
		Basic:   Move{Name: "Quick Attack", Damage: 9, Range: 145, CooldownMs: 450},
		Special: Move{Name: "Thunderbolt", Damage: 26, Range: 225, CooldownMs: 4500}},
	{ID: "charmander", Name: "Charmander", Type: "Fire", Level: 50, MaxHP: 110, Speed: 215,
		Basic:   Move{Name: "Scratch", Damage: 11, Range: 135, CooldownMs: 550},
		Special: Move{Name: "Flamethrower", Damage: 29, Range: 205, CooldownMs: 5000}},
}

func Cards() []Card { return cards }

func FindCard(id string) (Card, bool) {
	for _, c := range cards {
		if c.ID == id {
			return c, true
		}
	}
	return Card{}, false
}

type Fighter struct {
	Name              string  `json:"name"`
	Card              Card    `json:"card"`
	X                 float64 `json:"x"`
	Y                 float64 `json:"y"`
	HP                int     `json:"hp"`
	Energy            int     `json:"energy"`
	BasicCooldownMs   int     `json:"basicCooldownMs"`
	SpecialCooldownMs int     `json:"specialCooldownMs"`
	DodgeCooldownMs   int     `json:"dodgeCooldownMs"`
	Dodging           bool    `json:"dodging"`
	Charging          bool    `json:"charging"`
	ChargeMsLeft      int     `json:"chargeMsLeft"`
	ChargeX           float64 `json:"chargeX"`
	ChargeY           float64 `json:"chargeY"`
	ChargeDX          float64 `json:"chargeDx"`
	ChargeDY          float64 `json:"chargeDy"`
	LastAttack        string  `json:"lastAttack,omitempty"`
	LastAttackTick    int     `json:"lastAttackTick"`
	AttackX           float64 `json:"attackX"`
	AttackY           float64 `json:"attackY"`
	AttackDX          float64 `json:"attackDx"`
	AttackDY          float64 `json:"attackDy"`
	AttackTargetX     float64 `json:"attackTargetX"`
	AttackTargetY     float64 `json:"attackTargetY"`
	LastAttackHit     bool    `json:"lastAttackHit"`
	Token             string  `json:"-"`
	basicReady        int
	specialReady      int
	dodgeReady        int
	dodgeUntil        int
	dodgeHeld         bool
	specialHeld       bool
	pendingSpecial    bool
	chargeEndTick     int
}

type Input struct {
	DX      float64 `json:"dx"`
	DY      float64 `json:"dy"`
	AimX    float64 `json:"aimX"`
	AimY    float64 `json:"aimY"`
	Basic   bool    `json:"basic"`
	Special bool    `json:"special"`
	Dodge   bool    `json:"dodge"`
}

type Game struct {
	ID       string
	Fighters [2]*Fighter
	Inputs   [2]Input
	Tick     int
	Winner   string
}

type View struct {
	ID         string      `json:"id"`
	Status     string      `json:"status"`
	You        int         `json:"you"`
	Fighters   [2]*Fighter `json:"fighters"`
	Tick       int         `json:"tick"`
	TimeLeftMs int         `json:"timeLeftMs"`
	Winner     string      `json:"winner,omitempty"`
}

func New(id, name, cardID, token string) (*Game, error) {
	card, ok := FindCard(cardID)
	if !ok {
		return nil, ErrCard
	}
	return &Game{ID: id, Fighters: [2]*Fighter{{Name: name, Card: card, HP: card.MaxHP, X: 120, Y: Height / 2, Token: token}}}, nil
}

func (g *Game) Join(name, cardID, token string) error {
	if g.Fighters[1] != nil {
		return ErrFull
	}
	card, ok := FindCard(cardID)
	if !ok {
		return ErrCard
	}
	g.Fighters[1] = &Fighter{Name: name, Card: card, HP: card.MaxHP, X: Width - 120, Y: Height / 2, Token: token}
	return nil
}

func (g *Game) PlayerIndex(token string) int {
	for i, f := range g.Fighters {
		if f != nil && f.Token == token {
			return i
		}
	}
	return -1
}

func (g *Game) ViewFor(index int) View {
	status := "playing"
	if g.Fighters[1] == nil {
		status = "waiting"
	} else if g.Winner != "" {
		status = "finished"
	}
	var fighters [2]*Fighter
	for i, f := range g.Fighters {
		if f == nil {
			continue
		}
		copy := *f
		copy.Token = ""
		copy.BasicCooldownMs = max(0, (f.basicReady-g.Tick)*TickMs)
		copy.SpecialCooldownMs = max(0, (f.specialReady-g.Tick)*TickMs)
		copy.DodgeCooldownMs = max(0, (f.dodgeReady-g.Tick)*TickMs)
		copy.Dodging = g.Tick < f.dodgeUntil
		copy.Charging = f.pendingSpecial
		copy.ChargeMsLeft = max(0, (f.chargeEndTick-g.Tick)*TickMs)
		fighters[i] = &copy
	}
	return View{ID: g.ID, Status: status, You: index, Fighters: fighters, Tick: g.Tick,
		TimeLeftMs: max(0, (MatchTicks-g.Tick)*TickMs), Winner: g.Winner}
}

func (g *Game) SetInput(index int, input Input) {
	if index < 0 || index > 1 || g.Winner != "" {
		return
	}
	if math.IsNaN(input.DX) || math.IsInf(input.DX, 0) {
		input.DX = 0
	}
	if math.IsNaN(input.DY) || math.IsInf(input.DY, 0) {
		input.DY = 0
	}
	if math.IsNaN(input.AimX) || math.IsInf(input.AimX, 0) {
		input.AimX = 0
	}
	if math.IsNaN(input.AimY) || math.IsInf(input.AimY, 0) {
		input.AimY = 0
	}
	input.DX = math.Max(-1, math.Min(1, input.DX))
	input.DY = math.Max(-1, math.Min(1, input.DY))
	if length := math.Hypot(input.AimX, input.AimY); length > 1 {
		input.AimX /= length
		input.AimY /= length
	}
	g.Inputs[index] = input
}

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
		if f.Card.ID == "charmander" && kind == "special" && distance > 0 {
			// Flamethrower covers a 52-degree cone in the aimed direction.
			hit = hit && (aimX*targetDX+aimY*targetDY)/distance >= math.Cos(26*math.Pi/180)
		}
		f.LastAttack, f.LastAttackTick = kind, g.Tick
		f.AttackX, f.AttackY = sourceX, sourceY
		f.AttackDX, f.AttackDY = aimX, aimY
		f.AttackTargetX, f.AttackTargetY = target.X, target.Y
		f.LastAttackHit = hit
		if hit && g.Tick >= target.dodgeUntil {
			damage[1-i] += move.Damage
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
