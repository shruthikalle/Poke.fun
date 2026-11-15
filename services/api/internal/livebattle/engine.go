package livebattle

import (
	"errors"
	"fmt"
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

// Battle holds authoritative state for one match. Every method returns the
// ordered events the client should apply; the client only renders and paces
// them, so the server stays the referee. Methods are not safe for concurrent
// use — the server serialises them under its mutex.
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
		seed = int64(rand.Uint64()) // unseeded request → a fresh random battle
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

// cloneTeam makes a fresh, full-HP/full-PP copy so the stored config is never
// mutated and a rematch starts clean.
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

// Open resets to a fresh battle (same seed) and returns the opening events.
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
	events := []Event{
		evInit(b.ID, b.format, b.sides, b.you.Name, b.timerEnabled),
		evJoin(b.opponent.Name),
		evJoin(b.you.Name),
		evStart(),
		evSwitch("p2", 0),
		evSwitch("p1", 0),
	}
	return append(events, b.beginTurn(true)...)
}

// beginTurn opens a turn and asks the player to choose.
func (b *Battle) beginTurn(first bool) []Event {
	if !first {
		b.turn++
	}
	b.awaiting = true
	events := []Event{evTurn(b.turn)}
	if b.timerEnabled {
		events = append(events, evTimer(true, turnSeconds))
	}
	return append(events, evRequest("choosing"))
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

	// A forced switch (the active creature fainted) resolves immediately with no
	// opponent action and starts the next turn.
	if b.needsSwitch {
		if choice.Kind != "switch" || !b.validSwitch(mine, choice.TeamIndex) {
			return nil, fmt.Errorf("%w: must switch in a healthy creature", ErrInvalidChoice)
		}
		b.needsSwitch = false
		b.awaiting = false
		mine.ActiveIndex = choice.TeamIndex
		events := []Event{evResolving(), evSwitch("p1", choice.TeamIndex)}
		return append(events, b.beginTurn(false)...), nil
	}

	if err := b.validateChoice(mine, choice); err != nil {
		return nil, err
	}
	b.awaiting = false
	c := choice
	b.pending = &c
	events := []Event{evChoiceAccepted(choice)}
	return append(events, b.resolveTurn()...), nil
}

func (b *Battle) validateChoice(side *SideState, choice Choice) error {
	switch choice.Kind {
	case "switch":
		if !b.validSwitch(side, choice.TeamIndex) {
			return ErrInvalidChoice
		}
	case "move":
		moves := side.Team[side.ActiveIndex].Moves
		if choice.MoveIndex < 0 || choice.MoveIndex >= len(moves) || moves[choice.MoveIndex].PP <= 0 {
			return ErrInvalidChoice
		}
	default:
		return ErrInvalidChoice
	}
	return nil
}

func (b *Battle) validSwitch(side *SideState, index int) bool {
	if index < 0 || index >= len(side.Team) || index == side.ActiveIndex {
		return false
	}
	return !side.Team[index].Fainted
}

// SetTimer toggles the turn timer and returns the resulting events.
func (b *Battle) SetTimer(enabled bool) []Event {
	b.timerEnabled = enabled
	events := []Event{evTimer(enabled, timerSeconds(enabled))}
	if enabled {
		return append(events, evChat("", fmt.Sprintf("Battle timer is ON: inactive players will automatically lose when time's up. (requested by %s)", b.you.Name)))
	}
	return append(events, evChat("", "Battle timer is now OFF."))
}

func timerSeconds(enabled bool) any {
	if enabled {
		return turnSeconds
	}
	return nil
}

// Chat echoes the player's line and, sometimes, an opponent reply.
func (b *Battle) Chat(text string) []Event {
	events := []Event{evChat(b.you.Name, text)}
	if b.rng.Float64() < 0.4 {
		events = append(events, evChat(b.opponent.Name, opponentLines[b.rng.Intn(len(opponentLines))]))
	}
	return events
}

// Over reports whether the battle has ended.
func (b *Battle) Over() bool { return b.over }
