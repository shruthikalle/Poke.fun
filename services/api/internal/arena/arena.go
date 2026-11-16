package arena

import (
	"errors"
	"math"
	"time"
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
	ID                 string
	Fighters           [2]*Fighter
	Inputs             [2]Input
	Tick               int
	Winner             string
	EndReason          string
	Running            bool
	Connected          [2]bool
	EverConnected      [2]bool
	DisconnectDeadline [2]time.Time
	Frames             []ReplayFrame
}

type View struct {
	ID                 string       `json:"id"`
	Status             string       `json:"status"`
	You                int          `json:"you"`
	Fighters           [2]*Fighter  `json:"fighters"`
	Tick               int          `json:"tick"`
	TimeLeftMs         int          `json:"timeLeftMs"`
	Winner             string       `json:"winner,omitempty"`
	EndReason          string       `json:"endReason,omitempty"`
	Connected          [2]bool      `json:"connected"`
	DisconnectDeadline [2]time.Time `json:"disconnectDeadline"`
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
	g.Frames = []ReplayFrame{g.ReplayFrame()}
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
		TimeLeftMs: max(0, (MatchTicks-g.Tick)*TickMs), Winner: g.Winner, EndReason: g.ResultReason(), Connected: g.Connected, DisconnectDeadline: g.DisconnectDeadline}
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

func (g *Game) Forfeit(index int) error {
	if index < 0 || index > 1 || g.Fighters[1] == nil || g.Winner != "" {
		return errors.New("only a player in an active match can forfeit")
	}
	if index == 0 {
		g.Winner = "player2"
	} else {
		g.Winner = "player1"
	}
	g.EndReason = "forfeit"
	g.Inputs = [2]Input{}
	return nil
}
