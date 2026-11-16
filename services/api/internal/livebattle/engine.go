package livebattle

import (
	"errors"
	"fmt"
	"math/rand"
	"time"
)

var (
	ErrNotYourTurn   = errors.New("not waiting for a choice from you")
	ErrInvalidChoice = errors.New("invalid choice")
	ErrFinished      = errors.New("battle is finished")
	ErrNotStarted    = errors.New("waiting for both teams")
	ErrWrongMode     = errors.New("not allowed in this battle mode")
)

// Mode decides who controls side p2: the server AI, or a second human.
type Mode string

const (
	ModeAI  Mode = "ai"
	ModePvP Mode = "pvp"
)

const turnSeconds = 150

// turnDeadline is how long a side may take to choose while the timer is on.
// Online (PvP) battles always run the timer so one player can't stall the other.
const turnDeadline = turnSeconds * time.Second

var sides = []string{"p1", "p2"}

// Config is the setup for a battle. AI battles arrive with both teams; PvP
// battles receive validated queue selections; legacy direct setup can submit
// each side once through SetTeam. Incoming combat fields are never trusted.
type Config struct {
	Mode     Mode                  `json:"mode"`
	You      Trainer               `json:"you"`
	Opponent Trainer               `json:"opponent"`
	Teams    map[string][]Creature `json:"teams"` // keys "p1" and "p2"
	Format   Format                `json:"format"`
	Seed     int64                 `json:"seed"`
}

// Battle is the authoritative state of one match. Turns use simultaneous hidden
// choice: each side submits secretly and the server resolves only when both are
// in. Every outcome is appended to an event log that all clients read, so both
// players see the same battle. Not safe for concurrent use; the server
// serialises calls under its mutex.
type Battle struct {
	ID string

	mode     Mode
	trainers map[string]Trainer
	formats  map[string]Format     // per-side display format; p1's is shown
	initial  map[string][]Creature // locked teams; a rematch restores from here
	tokens   map[string]string     // side → player token

	sides        map[string]*SideState
	turn         int
	pending      map[string]*Choice // hidden choices for the current turn
	switchQueue  []string           // sides that must replace a fainted creature
	started      bool
	over         bool
	timerEnabled bool
	deadline     time.Time
	rng          *snapshotRNG
	seed         int64
	log          []Event
	round        int
	rematchVotes map[string]bool
	weather      string // "", "rain", "sun", "sand", "hail" or "snow"
	weatherTurns int
	// Per-turn scratch state, reset by resolveTurn (never between turns).
	flinched map[string]bool
	acted    map[string]bool
}

// New builds a battle. AI battles need both teams and open immediately; PvP
// battles open when both locked teams exist (or after legacy SetTeam setup).
func New(id string, cfg Config) (*Battle, error) {
	mode := cfg.Mode
	if mode == "" {
		mode = ModeAI
	}
	if mode != ModeAI && mode != ModePvP {
		return nil, fmt.Errorf("%w: unknown mode %q", ErrInvalidChoice, mode)
	}
	if mode == ModeAI && (len(cfg.Teams["p1"]) == 0 || len(cfg.Teams["p2"]) == 0) {
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
	b := &Battle{
		ID:           id,
		mode:         mode,
		trainers:     map[string]Trainer{"p1": cfg.You, "p2": opp},
		formats:      map[string]Format{"p1": cfg.Format},
		initial:      map[string][]Creature{},
		tokens:       map[string]string{},
		timerEnabled: mode == ModePvP,
		seed:         seed,
	}
	for _, side := range sides {
		if team := cfg.Teams[side]; len(team) > 0 {
			canonical, err := CanonicalTeam(team, side)
			if err != nil {
				return nil, err
			}
			if mode == ModePvP && len(canonical) != 1 && len(canonical) != 3 {
				return nil, fmt.Errorf("PvP teams must have 1 or 3 creatures")
			}
			if expected := formatSize(cfg.Format); mode == ModePvP && expected != 0 && len(canonical) != expected {
				return nil, fmt.Errorf("team does not match the declared format")
			}
			b.initial[side] = canonical
		}
	}
	if len(b.initial["p1"]) > 0 && len(b.initial["p2"]) > 0 && mode == ModePvP && len(b.initial["p1"]) != len(b.initial["p2"]) {
		return nil, fmt.Errorf("both teams must use the same format")
	}
	if len(b.initial["p1"]) > 0 {
		b.formats["p1"] = TeamFormat(len(b.initial["p1"]), mode == ModePvP)
	}
	if mode == ModeAI || (len(b.initial["p1"]) > 0 && len(b.initial["p2"]) > 0) {
		b.Open()
	}
	return b, nil
}

// SetToken assigns the player token that authenticates a side.
func (b *Battle) SetToken(side, token string) { b.tokens[side] = token }

// SideFor returns the side a token controls, or "" if it controls none.
func (b *Battle) SideFor(token string) string {
	for side, t := range b.tokens {
		if t != "" && t == token {
			return side
		}
	}
	return ""
}

// Mode reports whether side p2 is the AI or a second human.
func (b *Battle) Mode() Mode { return b.mode }

// Started reports whether both teams are in and play has begun.
func (b *Battle) Started() bool { return b.started }

// Over reports whether the battle has ended.
func (b *Battle) Over() bool { return b.over }

// EventsSince returns the log entries after index since, plus the new cursor.
func (b *Battle) EventsSince(since int) ([]Event, int) {
	if since < 0 || since > len(b.log) {
		since = len(b.log)
	}
	return append([]Event(nil), b.log[since:]...), len(b.log)
}

func (b *Battle) record(events ...Event) { b.log = append(b.log, events...) }

// cloneTeam makes a fresh, full-HP/full-PP copy so the stored team is never
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

// Open (re)starts the battle from the locked teams and records the opening
// events. It is also how a rematch begins; the init event resets each client.
func (b *Battle) Open() {
	b.round++
	b.rematchVotes = map[string]bool{}
	b.rng = newSnapshotRNG(b.seed)
	b.turn = 1
	b.pending = map[string]*Choice{}
	b.switchQueue = nil
	b.over = false
	b.started = true
	b.weather, b.weatherTurns = "", 0
	b.sides = map[string]*SideState{}
	for _, side := range sides {
		b.sides[side] = &SideState{Side: side, Trainer: b.trainers[side], Team: cloneTeam(b.initial[side])}
	}
	format := b.formats["p1"]
	if format.Name == "" {
		format = b.formats["p2"]
	}
	users := []string{b.trainers["p1"].Name, b.trainers["p2"].Name}
	b.record(
		evInit(b.ID, format, b.sides, users, b.timerEnabled),
		evJoin(b.trainers["p2"].Name),
		evJoin(b.trainers["p1"].Name),
		evStart(),
		evSwitch("p2", 0),
		evSwitch("p1", 0),
	)
	b.record(b.beginTurn(true)...)
}

// beginTurn opens a turn in which both sides choose.
func (b *Battle) beginTurn(first bool) []Event {
	if !first {
		b.turn++
	}
	b.armDeadline()
	events := []Event{evTurn(b.turn)}
	if b.timerEnabled {
		events = append(events, evTimer(true, turnSeconds))
	}
	return append(events, evRequest("choosing", ""))
}

// armDeadline starts the clock for the current decision when the timer is on.
func (b *Battle) armDeadline() {
	if b.timerEnabled {
		b.deadline = time.Now().Add(turnDeadline)
	} else {
		b.deadline = time.Time{}
	}
}

// SetTimer toggles the turn timer. Online battles keep it on permanently.
func (b *Battle) SetTimer(side string, enabled bool) {
	name := b.trainers[side].Name
	if b.mode == ModePvP {
		b.record(evChat("", "The battle timer stays on in online matches."))
		return
	}
	b.timerEnabled = enabled
	b.armDeadline()
	b.record(evTimer(enabled, timerSeconds(enabled)))
	if enabled {
		b.record(evChat("", fmt.Sprintf("Battle timer is ON: a move is picked automatically when time's up. (requested by %s)", name)))
	} else {
		b.record(evChat("", "Battle timer is now OFF."))
	}
}

func timerSeconds(enabled bool) any {
	if enabled {
		return turnSeconds
	}
	return nil
}

// Chat records a player's line without simulating a human response.
func (b *Battle) Chat(side, text string) {
	b.record(evChat(b.trainers[side].Name, text))
}
