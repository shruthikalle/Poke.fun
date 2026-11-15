package battle

import (
	"errors"
	"math"
	"time"
)

var (
	ErrInvalidCard   = errors.New("unknown card")
	ErrMatchFull     = errors.New("match is full")
	ErrNotReady      = errors.New("waiting for a second player")
	ErrFinished      = errors.New("match is finished")
	ErrInvalidAttack = errors.New("attack is unavailable")
	ErrAlreadyPlayed = errors.New("attack already submitted this turn")
)

// TurnDuration is how long each player has to submit an attack before the
// server auto-plays their quick attack for them (PRD R-02).
const TurnDuration = 60 * time.Second

type Player struct {
	Name   string `json:"name"`
	Card   Card   `json:"card"`
	HP     int    `json:"hp"`
	Energy int    `json:"energy"`
	Token  string `json:"-"`
}

type Turn struct {
	Number  int       `json:"number"`
	Attacks [2]string `json:"attacks"`
	Damage  [2]int    `json:"damage"`
	// Effect is the type effectiveness of each player's attack this turn:
	// "super", "resisted", "immune" or "normal".
	Effect [2]string `json:"effect"`
	// Auto is true for a player whose attack was chosen by the turn timer.
	Auto [2]bool `json:"auto"`
	HP   [2]int  `json:"hp"`
}

type Match struct {
	ID             string
	Players        [2]*Player
	Pending        [2]string
	Turn           int
	Winner         string // "player1", "player2", "draw", or empty while playing
	History        []Turn
	RulesVersion   string
	CatalogVersion string
	// Deadline is when the current turn's unsubmitted attacks are auto-played.
	// Zero while waiting for a second player or after the match is finished.
	Deadline time.Time
}

type View struct {
	ID             string     `json:"id"`
	Status         string     `json:"status"`
	You            int        `json:"you"`
	Players        [2]*Player `json:"players"`
	Submitted      [2]bool    `json:"submitted"`
	Turn           int        `json:"turn"`
	Winner         string     `json:"winner,omitempty"`
	History        []Turn     `json:"history"`
	RulesVersion   string     `json:"rulesVersion"`
	CatalogVersion string     `json:"catalogVersion"`
	// DeadlineUnixMs is the current turn's auto-play time in Unix milliseconds,
	// or 0 when there is no running turn.
	DeadlineUnixMs int64 `json:"deadlineUnixMs,omitempty"`
}

func NewMatch(id, name, cardID, token string) (*Match, error) {
	card, ok := FindCard(cardID)
	if !ok {
		return nil, ErrInvalidCard
	}
	return &Match{
		ID:             id,
		Players:        [2]*Player{{Name: name, Card: card, HP: card.MaxHP, Token: token}, nil},
		Turn:           1,
		History:        []Turn{},
		RulesVersion:   RulesVersion,
		CatalogVersion: CatalogVersion,
	}, nil
}

func (m *Match) Join(name, cardID, token string) error {
	if m.Players[1] != nil {
		return ErrMatchFull
	}
	card, ok := FindCard(cardID)
	if !ok {
		return ErrInvalidCard
	}
	m.Players[1] = &Player{Name: name, Card: card, HP: card.MaxHP, Token: token}
	m.Deadline = time.Now().Add(TurnDuration) // turn 1 clock starts
	return nil
}

func (m *Match) PlayerIndex(token string) int {
	for i, player := range m.Players {
		if player != nil && player.Token == token {
			return i
		}
	}
	return -1
}

func (m *Match) status() string {
	switch {
	case m.Players[1] == nil:
		return "waiting"
	case m.Winner != "":
		return "finished"
	default:
		return "playing"
	}
}

func (m *Match) ViewFor(index int) View {
	status := m.status()
	var players [2]*Player
	for i, player := range m.Players {
		if player != nil {
			copy := *player
			copy.Token = ""
			players[i] = &copy
		}
	}
	var deadlineMs int64
	if status == "playing" && !m.Deadline.IsZero() {
		deadlineMs = m.Deadline.UnixMilli()
	}
	return View{
		ID: m.ID, Status: status, You: index,
		Players:        players,
		Submitted:      [2]bool{m.Pending[0] != "", m.Pending[1] != ""},
		Turn:           m.Turn,
		Winner:         m.Winner,
		History:        append([]Turn{}, m.History...),
		RulesVersion:   m.RulesVersion,
		CatalogVersion: m.CatalogVersion,
		DeadlineUnixMs: deadlineMs,
	}
}

func (m *Match) Submit(index int, attackID string) error {
	if m.Players[1] == nil {
		return ErrNotReady
	}
	if m.Winner != "" {
		return ErrFinished
	}
	if m.Pending[index] != "" {
		return ErrAlreadyPlayed
	}
	if _, ok := availableAttack(m.Players[index], attackID); !ok {
		return ErrInvalidAttack
	}
	m.Pending[index] = attackID
	if m.Pending[0] != "" && m.Pending[1] != "" {
		m.resolve([2]bool{})
	}
	return nil
}

// ApplyTimeout auto-plays any attacks still missing once the turn deadline has
// passed, resolving the turn deterministically. It is safe to call on every
// request; it does nothing until the deadline is reached. Returns true if the
// turn was advanced.
func (m *Match) ApplyTimeout(now time.Time) bool {
	if m.status() != "playing" || m.Deadline.IsZero() || now.Before(m.Deadline) {
		return false
	}
	var auto [2]bool
	for i := range m.Players {
		if m.Pending[i] == "" {
			m.Pending[i] = autoAttack(m.Players[i])
			auto[i] = true
		}
	}
	m.resolve(auto)
	return true
}

// autoAttack picks the cheapest affordable attack, i.e. a quick (zero-cost)
// move. Every card has one, so this always returns a playable attack.
func autoAttack(player *Player) string {
	best := player.Card.Attacks[0]
	for _, attack := range player.Card.Attacks {
		if player.Energy >= attack.Cost && attack.Cost < best.Cost {
			best = attack
		}
	}
	return best.ID
}

func availableAttack(player *Player, id string) (Attack, bool) {
	for _, attack := range player.Card.Attacks {
		if attack.ID == id && player.Energy >= attack.Cost {
			return attack, true
		}
	}
	return Attack{}, false
}

// attackDamage applies type effectiveness and same-type attack bonus (STAB).
// A non-immune hit always deals at least 1 damage.
func attackDamage(attacker, defender *Player, atk Attack) (int, string) {
	element := atk.Element
	if element == "" {
		element = "Normal"
	}
	mult := TypeMultiplier(element, defender.Card.Element)
	stab := 1.0
	if element == attacker.Card.Element {
		stab = 1.5
	}
	damage := int(math.Round(float64(atk.Damage) * stab * mult))
	if mult > 0 && damage < 1 {
		damage = 1
	}
	return damage, EffectivenessLabel(mult)
}

func (m *Match) resolve(auto [2]bool) {
	var attacks [2]Attack
	var damage [2]int
	var effect [2]string
	for i := range m.Players {
		attacks[i], _ = availableAttack(m.Players[i], m.Pending[i])
		damage[i], effect[i] = attackDamage(m.Players[i], m.Players[1-i], attacks[i])
	}
	for i := range m.Players {
		m.Players[i].Energy += attacks[i].Gain - attacks[i].Cost
		m.Players[i].HP -= damage[1-i]
		if m.Players[i].HP < 0 {
			m.Players[i].HP = 0
		}
	}
	m.History = append(m.History, Turn{
		Number:  m.Turn,
		Attacks: [2]string{attacks[0].Name, attacks[1].Name},
		Damage:  damage,
		Effect:  effect,
		Auto:    auto,
		HP:      [2]int{m.Players[0].HP, m.Players[1].HP},
	})
	m.Pending = [2]string{}
	m.Turn++
	switch {
	case m.Players[0].HP == 0 && m.Players[1].HP == 0:
		m.Winner = "draw"
	case m.Players[0].HP == 0:
		m.Winner = "player2"
	case m.Players[1].HP == 0:
		m.Winner = "player1"
	}
	if m.Winner != "" {
		m.Deadline = time.Time{}
	} else {
		m.Deadline = time.Now().Add(TurnDuration)
	}
}
