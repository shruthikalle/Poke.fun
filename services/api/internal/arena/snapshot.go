package arena

import (
	"encoding/json"
	"errors"
	"reflect"
	"time"
)

// FighterSnapshot includes private cooldown/charge state omitted by views.
type FighterSnapshot struct {
	State          Fighter `json:"state"`
	Token          string  `json:"token"`
	BasicReady     int     `json:"basicReady"`
	SpecialReady   int     `json:"specialReady"`
	DodgeReady     int     `json:"dodgeReady"`
	DodgeUntil     int     `json:"dodgeUntil"`
	PendingSpecial bool    `json:"pendingSpecial"`
	ChargeEndTick  int     `json:"chargeEndTick"`
}

type Snapshot struct {
	Version            int                 `json:"version"`
	ID                 string              `json:"id"`
	Tick               int                 `json:"tick"`
	Winner             string              `json:"winner"`
	EndReason          string              `json:"endReason"`
	EverConnected      [2]bool             `json:"everConnected"`
	DisconnectDeadline [2]time.Time        `json:"disconnectDeadline"`
	Fighters           [2]*FighterSnapshot `json:"fighters"`
	Frames             []ReplayFrame       `json:"frames,omitempty"`
}

func (g *Game) Snapshot() Snapshot {
	s := Snapshot{Version: 1, ID: g.ID, Tick: g.Tick, Winner: g.Winner, EndReason: g.EndReason, EverConnected: g.EverConnected, DisconnectDeadline: g.DisconnectDeadline, Frames: g.Frames}
	for i, f := range g.Fighters {
		if f != nil {
			s.Fighters[i] = &FighterSnapshot{State: *f, Token: f.Token,
				BasicReady: f.basicReady, SpecialReady: f.specialReady, DodgeReady: f.dodgeReady,
				DodgeUntil: f.dodgeUntil, PendingSpecial: f.pendingSpecial, ChargeEndTick: f.chargeEndTick}
		}
	}
	data, _ := json.Marshal(s)
	var copy Snapshot
	_ = json.Unmarshal(data, &copy)
	return copy
}

// Restore deliberately clears live inputs and held button latches. A committed
// special keeps its charge and aim; a stale connection cannot keep attacking.
// Arena time pauses during downtime; cooldowns remain relative to Tick.
func Restore(s Snapshot) (*Game, error) {
	invalid := errors.New("invalid arena snapshot")
	if s.Version != 1 || s.ID == "" || s.Tick < 0 || s.Tick > MatchTicks || s.Fighters[0] == nil {
		return nil, invalid
	}
	if s.Winner != "" && s.Winner != "player1" && s.Winner != "player2" && s.Winner != "draw" {
		return nil, invalid
	}
	data, err := json.Marshal(s) // rejects nonfinite coordinates
	if err != nil {
		return nil, invalid
	}
	var copy Snapshot
	if json.Unmarshal(data, &copy) != nil {
		return nil, invalid
	}
	g := &Game{ID: copy.ID, Tick: copy.Tick, Winner: copy.Winner, EndReason: copy.EndReason, EverConnected: copy.EverConnected, DisconnectDeadline: copy.DisconnectDeadline, Frames: copy.Frames}
	for i, saved := range copy.Fighters {
		if saved == nil {
			continue
		}
		f := saved.State
		card, ok := FindCard(f.Card.ID)
		if !ok || !reflect.DeepEqual(card, f.Card) || f.Name == "" || saved.Token == "" || f.HP < 0 || f.HP > card.MaxHP || f.Energy < 0 || f.Energy > MaxEnergy || f.X < 0 || f.X > Width || f.Y < 0 || f.Y > Height || saved.BasicReady < 0 || saved.SpecialReady < 0 || saved.DodgeReady < 0 || saved.DodgeUntil < 0 || saved.ChargeEndTick < 0 {
			return nil, invalid
		}
		f.Token = saved.Token
		f.basicReady, f.specialReady = saved.BasicReady, saved.SpecialReady
		f.dodgeReady, f.dodgeUntil = saved.DodgeReady, saved.DodgeUntil
		f.pendingSpecial, f.chargeEndTick = saved.PendingSpecial, saved.ChargeEndTick
		f.dodgeHeld, f.specialHeld = false, false
		g.Fighters[i] = &f
	}
	if g.Fighters[1] == nil && (g.Tick != 0 || g.Winner != "") || g.Fighters[1] != nil && g.Fighters[0].Token == g.Fighters[1].Token || g.Tick == MatchTicks && g.Winner == "" {
		return nil, invalid
	}
	if g.Fighters[1] != nil && g.Winner == "" {
		for i := range g.DisconnectDeadline {
			g.DisconnectDeadline[i] = time.Time{}
		}
	}
	return g, nil
}
