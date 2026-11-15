package livebattle

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
)

var (
	ErrNotYourTurn   = errors.New("not waiting for a choice")
	ErrInvalidChoice = errors.New("invalid choice")
	ErrFinished      = errors.New("battle is finished")
)

const turnSeconds = 150

var opponentLines = []string{"gl hf", "nice switch", "oof", "that crit tho", "gg", "close one!"}

// Config is the client-supplied setup for a battle.
type Config struct {
	You      Trainer               `json:"you"`
	Opponent Trainer               `json:"opponent"`
	Teams    map[string][]Creature `json:"teams"` // keys "p1" (you) and "p2"
	Format   Format                `json:"format"`
	Seed     int64                 `json:"seed"`
}

// Battle holds authoritative state for one match. All methods return the ordered
// events the client should apply; the client only renders and paces them.
type Battle struct {
	ID    string
	Token string

	you      Trainer
	opponent Trainer
	format   Format
	initial  map[string][]Creature // locked at creation; rematch restores from here

	sides        map[string]*SideState
	turn         int
	pending      *Choice
	needsSwitch  bool
	awaiting     bool
	over         bool
	timerEnabled bool
	rng          *rand.Rand
	seed         int64
}

// New builds a battle from client config. It does not start play; call Open.
func New(id, token string, cfg Config) (*Battle, error) {
	if len(cfg.Teams["p1"]) == 0 || len(cfg.Teams["p2"]) == 0 {
		return nil, fmt.Errorf("%w: both teams are required", ErrInvalidChoice)
	}
	seed := cfg.Seed
	if seed == 0 {
		seed = int64(rand.Uint64())
	}
	opp := cfg.Opponent
	if opp.Name == "" {
		opp = Trainer{ID: "thar07", Name: "thar07", Avatar: "kai"}
	}
	return &Battle{
		ID:       id,
		Token:    token,
		you:      cfg.You,
		opponent: opp,
		format:   cfg.Format,
		initial:  map[string][]Creature{"p1": cfg.Teams["p1"], "p2": cfg.Teams["p2"]},
		seed:     seed,
		rng:      rand.New(rand.NewSource(seed)),
	}, nil
}

func cloneTeam(team []Creature) []*Creature {
	out := make([]*Creature, len(team))
	for i := range team {
		c := team[i]
		c.Moves = append([]Move(nil), team[i].Moves...)
		c.Types = append([]string(nil), team[i].Types...)
		c.HP = c.MaxHP
		c.Fainted = false
		for j := range c.Moves {
			c.Moves[j].PP = c.Moves[j].MaxPP
		}
		out[i] = &c
	}
	return out
}

// Open resets to a fresh battle and returns the opening events.
func (b *Battle) Open() []Event {
	b.rng = rand.New(rand.NewSource(b.seed))
	b.turn = 1
	b.pending = nil
	b.needsSwitch = false
	b.awaiting = false
	b.over = false
	b.sides = map[string]*SideState{
		"p1": {Side: "p1", Trainer: b.you, Team: cloneTeam(b.initial["p1"]), ActiveIndex: 0},
		"p2": {Side: "p2", Trainer: b.opponent, Team: cloneTeam(b.initial["p2"]), ActiveIndex: 0},
	}
	secondsLeft := any(nil)
	if b.timerEnabled {
		secondsLeft = turnSeconds
	}
	events := []Event{{
		"type": "init",
		"state": map[string]any{
			"id":            b.ID,
			"format":        b.format,
			"turn":          1,
			"you":           "p1",
			"sides":         b.sides,
			"users":         []string{b.you.Name},
			"pendingChoice": nil,
			"winner":        nil,
			"timer":         map[string]any{"enabled": b.timerEnabled, "secondsLeft": secondsLeft, "secondsPerTurn": turnSeconds},
		},
	}}
	events = append(events,
		Event{"type": "join", "name": b.opponent.Name},
		Event{"type": "join", "name": b.you.Name},
		Event{"type": "start"},
		Event{"type": "switch", "side": "p2", "teamIndex": 0},
		Event{"type": "switch", "side": "p1", "teamIndex": 0},
	)
	return append(events, b.beginTurn(true)...)
}

func (b *Battle) beginTurn(first bool) []Event {
	if !first {
		b.turn++
	}
	b.awaiting = true
	events := []Event{{"type": "turn", "turn": b.turn}}
	if b.timerEnabled {
		events = append(events, Event{"type": "timer", "enabled": true, "secondsLeft": turnSeconds})
	}
	return append(events, Event{"type": "request", "phase": "choosing"})
}

func (b *Battle) active(side string) *Creature {
	s := b.sides[side]
	return s.Team[s.ActiveIndex]
}

// Choose applies the player's (p1) action and resolves the turn.
func (b *Battle) Choose(choice Choice) ([]Event, error) {
	if b.over {
		return nil, ErrFinished
	}
	if b.pending != nil || !b.awaiting {
		return nil, ErrNotYourTurn
	}
	mine := b.sides["p1"]

	if b.needsSwitch {
		if choice.Kind != "switch" {
			return nil, fmt.Errorf("%w: must switch in a new creature", ErrInvalidChoice)
		}
		if !b.validSwitch(mine, choice.TeamIndex) {
			return nil, ErrInvalidChoice
		}
		b.needsSwitch = false
		b.awaiting = false
		events := []Event{{"type": "resolving"}}
		mine.ActiveIndex = choice.TeamIndex
		events = append(events, Event{"type": "switch", "side": "p1", "teamIndex": choice.TeamIndex})
		return append(events, b.beginTurn(false)...), nil
	}

	switch choice.Kind {
	case "switch":
		if !b.validSwitch(mine, choice.TeamIndex) {
			return nil, ErrInvalidChoice
		}
	case "move":
		m := mine.Team[mine.ActiveIndex].Moves
		if choice.MoveIndex < 0 || choice.MoveIndex >= len(m) || m[choice.MoveIndex].PP <= 0 {
			return nil, ErrInvalidChoice
		}
	default:
		return nil, ErrInvalidChoice
	}

	b.awaiting = false
	c := choice
	b.pending = &c
	events := []Event{{"type": "choice-accepted", "choice": choice}}
	return append(events, b.resolveTurn()...), nil
}

func (b *Battle) validSwitch(side *SideState, index int) bool {
	if index < 0 || index >= len(side.Team) || index == side.ActiveIndex {
		return false
	}
	return !side.Team[index].Fainted
}

func (b *Battle) resolveTurn() []Event {
	choice := *b.pending
	b.pending = nil
	events := []Event{{"type": "resolving"}}

	if choice.Kind == "switch" {
		b.sides["p1"].ActiveIndex = choice.TeamIndex
		events = append(events, Event{"type": "switch", "side": "p1", "teamIndex": choice.TeamIndex})
	}

	opponentMove := b.pickOpponentMove()
	type action struct {
		side      string
		moveIndex int
	}
	var order []action
	if choice.Kind == "move" {
		order = append(order, action{"p1", choice.MoveIndex})
	}
	order = append(order, action{"p2", opponentMove})
	// Faster creature acts first; ties broken by the seeded RNG.
	if len(order) == 2 && b.speedOf(order[1].side) > b.speedOf(order[0].side) {
		order[0], order[1] = order[1], order[0]
	}

	for _, act := range order {
		events = append(events, b.performMove(act.side, act.moveIndex)...)
		if b.checkOver(&events) {
			return events
		}
	}

	// End of turn: force switches or start the next turn.
	if b.active("p2").Fainted {
		next := b.firstAlive("p2")
		b.sides["p2"].ActiveIndex = next
		events = append(events, Event{"type": "switch", "side": "p2", "teamIndex": next})
	}
	if b.active("p1").Fainted {
		b.needsSwitch = true
		b.awaiting = true
		events = append(events, Event{"type": "request", "phase": "switching"})
		return events
	}
	return append(events, b.beginTurn(false)...)
}

func (b *Battle) performMove(side string, moveIndex int) []Event {
	attacker := b.active(side)
	defenderSide := otherSide(side)
	defender := b.active(defenderSide)
	if attacker.Fainted || defender.Fainted {
		return nil
	}
	m := &attacker.Moves[moveIndex]
	if m.PP > 0 {
		m.PP--
	}
	events := []Event{{"type": "move", "side": side, "moveIndex": moveIndex, "ppLeft": m.PP}}

	if b.rng.Float64()*100 >= float64(m.Accuracy) {
		return append(events, Event{"type": "miss", "side": defenderSide})
	}

	mult := effectiveness(m.Type, defender.Types)
	stab := 1.0
	if contains(attacker.Types, m.Type) {
		stab = 1.5
	}
	crit := b.rng.Float64() < 0.06
	atk, def := attacker.Stats.Atk, defender.Stats.Def
	if m.Category == "special" {
		atk, def = attacker.Stats.Spa, defender.Stats.Spd
	}
	base := (((2*float64(attacker.Level))/5+2)*float64(m.Power)*(float64(atk)/float64(def)))/50 + 2
	critMult := 1.0
	if crit {
		critMult = 1.5
	}
	// Scaled below the games' formula so one-card matches last a few turns.
	damage := int(math.Round(base * stab * mult * critMult * (0.85 + b.rng.Float64()*0.15) * 0.55))
	if damage < 1 {
		damage = 1
	}
	if mult == 0 {
		damage = 0
	}
	defender.HP = defender.HP - damage
	if defender.HP < 0 {
		defender.HP = 0
	}
	events = append(events, Event{
		"type": "damage", "side": defenderSide, "hp": defender.HP,
		"effectiveness": effectivenessLabel(mult), "crit": crit,
	})
	if defender.HP == 0 {
		defender.Fainted = true
		events = append(events, Event{"type": "faint", "side": defenderSide})
	}
	return events
}

// checkOver ends the battle if a whole side has fainted, appending the win event.
func (b *Battle) checkOver(events *[]Event) bool {
	p1Out := b.allFainted("p1")
	p2Out := b.allFainted("p2")
	if !p1Out && !p2Out {
		return false
	}
	b.over = true
	winner := "p1"
	switch {
	case p1Out && p2Out:
		winner = "draw"
	case p1Out:
		winner = "p2"
	}
	*events = append(*events, Event{"type": "win", "winner": winner})
	return true
}

func (b *Battle) pickOpponentMove() int {
	attacker := b.active("p2")
	defender := b.active("p1")
	best, bestScore := 0, math.Inf(-1)
	for i, m := range attacker.Moves {
		score := -1.0
		if m.PP > 0 {
			score = float64(m.Power) * effectiveness(m.Type, defender.Types) * (0.7 + b.rng.Float64()*0.6)
		}
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	return best
}

func (b *Battle) speedOf(side string) float64 {
	c := b.active(side)
	return float64(c.Speed) + float64(c.Level)/10 + b.rng.Float64()
}

func (b *Battle) firstAlive(side string) int {
	for i, c := range b.sides[side].Team {
		if !c.Fainted {
			return i
		}
	}
	return 0
}

func (b *Battle) allFainted(side string) bool {
	for _, c := range b.sides[side].Team {
		if !c.Fainted {
			return false
		}
	}
	return true
}

// SetTimer toggles the turn timer and returns the resulting events.
func (b *Battle) SetTimer(enabled bool) []Event {
	b.timerEnabled = enabled
	events := []Event{{"type": "timer", "enabled": enabled, "secondsLeft": timerSeconds(enabled)}}
	if enabled {
		events = append(events, Event{"type": "chat", "user": "", "text": fmt.Sprintf("Battle timer is ON: inactive players will automatically lose when time's up. (requested by %s)", b.you.Name)})
	} else {
		events = append(events, Event{"type": "chat", "user": "", "text": "Battle timer is now OFF."})
	}
	return events
}

func timerSeconds(enabled bool) any {
	if enabled {
		return turnSeconds
	}
	return nil
}

// Chat echoes the player's line and, sometimes, an opponent reply.
func (b *Battle) Chat(text string) []Event {
	events := []Event{{"type": "chat", "user": b.you.Name, "text": text}}
	if b.rng.Float64() < 0.4 {
		events = append(events, Event{"type": "chat", "user": b.opponent.Name, "text": opponentLines[b.rng.Intn(len(opponentLines))]})
	}
	return events
}

// Over reports whether the battle has ended.
func (b *Battle) Over() bool { return b.over }

func otherSide(side string) string {
	if side == "p1" {
		return "p2"
	}
	return "p1"
}
