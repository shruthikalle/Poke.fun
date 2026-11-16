package livebattle

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"
)

// Snapshot is a server-private, versioned checkpoint. Never return it from an
// API endpoint: tokens and simultaneous pending choices are intentionally here.
type Snapshot struct {
	Version      int                   `json:"version"`
	DexVersion   string                `json:"dexVersion"`
	ID           string                `json:"id"`
	Mode         Mode                  `json:"mode"`
	Trainers     map[string]Trainer    `json:"trainers"`
	Formats      map[string]Format     `json:"formats"`
	Initial      map[string][]Creature `json:"initial"`
	Tokens       map[string]string     `json:"tokens"`
	Sides        map[string]*SideState `json:"sides"`
	Turn         int                   `json:"turn"`
	Pending      map[string]*Choice    `json:"pending"`
	SwitchQueue  []string              `json:"switchQueue"`
	Started      bool                  `json:"started"`
	Over         bool                  `json:"over"`
	TimerEnabled bool                  `json:"timerEnabled"`
	Deadline     time.Time             `json:"deadline"`
	Seed         int64                 `json:"seed"`
	RNGDraws     uint64                `json:"rngDraws"`
	Log          []Event               `json:"log"`
	Round        int                   `json:"round"`
	RematchVotes map[string]bool       `json:"rematchVotes"`
	Weather      string                `json:"weather,omitempty"`
	WeatherTurns int                   `json:"weatherTurns,omitempty"`
}

func (b *Battle) Snapshot() Snapshot {
	s := Snapshot{Version: 1, DexVersion: pokedex.Version(), ID: b.ID, Mode: b.mode,
		Trainers: b.trainers, Formats: b.formats, Initial: b.initial, Tokens: b.tokens,
		Sides: b.sides, Turn: b.turn, Pending: b.pending, SwitchQueue: b.switchQueue,
		Started: b.started, Over: b.over, TimerEnabled: b.timerEnabled, Deadline: b.deadline,
		Seed: b.seed, Log: b.log, Round: b.round, RematchVotes: b.rematchVotes,
		Weather: b.weather, WeatherTurns: b.weatherTurns}
	if b.rng != nil {
		s.RNGDraws = b.rng.source.draws
	}
	data, _ := json.Marshal(s)
	var copy Snapshot
	_ = json.Unmarshal(data, &copy)
	return copy
}

func Restore(s Snapshot) (*Battle, error) {
	invalid := errors.New("invalid team battle snapshot")
	if s.Version != 1 || s.DexVersion != pokedex.Version() || s.ID == "" || s.Mode != ModeAI && s.Mode != ModePvP || s.RNGDraws > 10_000_000 {
		return nil, invalid
	}
	data, err := json.Marshal(s)
	if err != nil {
		return nil, invalid
	}
	var copy Snapshot
	if json.Unmarshal(data, &copy) != nil {
		return nil, invalid
	}
	s = copy
	b := &Battle{ID: s.ID, mode: s.Mode, trainers: s.Trainers, formats: s.Formats,
		initial: s.Initial, tokens: s.Tokens, sides: s.Sides, turn: s.Turn,
		pending: s.Pending, switchQueue: s.SwitchQueue, started: s.Started, over: s.Over,
		timerEnabled: s.TimerEnabled, deadline: s.Deadline, seed: s.Seed, log: s.Log,
		round: s.Round, rematchVotes: s.RematchVotes, weather: s.Weather, weatherTurns: s.WeatherTurns}
	if err := b.validateSnapshot(); err != nil {
		return nil, err
	}
	if b.pending == nil {
		b.pending = map[string]*Choice{}
	}
	if b.rematchVotes == nil {
		b.rematchVotes = map[string]bool{}
	}
	b.rng = newSnapshotRNG(s.Seed)
	for i := uint64(0); i < s.RNGDraws; i++ {
		b.rng.source.Int63()
	}
	return b, nil
}
