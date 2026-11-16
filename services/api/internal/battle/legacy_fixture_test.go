package battle

// The original fictional demo stays isolated here to preserve its historical
// rule regression tests. No fixture card is registered in the active catalog.
import (
	_ "embed"
	"encoding/json"
	"math"
	"time"
)

type fixtureMatch Match

//go:embed cards.json
var fixtureData []byte
var fixtureCards = func() []Card {
	var cards []Card
	if err := json.Unmarshal(fixtureData, &cards); err != nil {
		panic(err)
	}
	return cards
}()

func findFixtureCard(id string) (Card, bool) {
	for _, c := range fixtureCards {
		if c.ID == id {
			return c, true
		}
	}
	return Card{}, false
}

func newFixtureMatch(id, name, cardID, token string) (*fixtureMatch, error) {
	card, ok := findFixtureCard(cardID)
	if !ok {
		return nil, ErrInvalidCard
	}
	return &fixtureMatch{
		ID:             id,
		Players:        [2]*Player{{Name: name, Card: card, HP: card.MaxHP, Token: token}, nil},
		Turn:           1,
		History:        []Turn{},
		RulesVersion:   RulesVersion,
		CatalogVersion: CatalogVersion,
	}, nil
}

func (m *fixtureMatch) Join(name, cardID, token string) error {
	if m.Players[1] != nil {
		return ErrMatchFull
	}
	card, ok := findFixtureCard(cardID)
	if !ok {
		return ErrInvalidCard
	}
	m.Players[1] = &Player{Name: name, Card: card, HP: card.MaxHP, Token: token}
	m.Deadline = time.Now().Add(TurnDuration) // turn 1 clock starts
	return nil
}

func (m *fixtureMatch) PlayerIndex(token string) int {
	for i, player := range m.Players {
		if player != nil && player.Token == token {
			return i
		}
	}
	return -1
}

func (m *fixtureMatch) status() string {
	switch {
	case m.Players[1] == nil:
		return "waiting"
	case m.Winner != "":
		return "finished"
	default:
		return "playing"
	}
}

func (m *fixtureMatch) ViewFor(index int) View {
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

func (m *fixtureMatch) Submit(index int, attackID string) error {
	if m.Players[1] == nil {
		return ErrNotReady
	}
	if m.Winner != "" {
		return ErrFinished
	}
	if m.Pending[index] != "" {
		return ErrAlreadyPlayed
	}
	if _, ok := fixtureAvailableAttack(m.Players[index], attackID); !ok {
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
func (m *fixtureMatch) ApplyTimeout(now time.Time) bool {
	if m.status() != "playing" || m.Deadline.IsZero() || now.Before(m.Deadline) {
		return false
	}
	var auto [2]bool
	for i := range m.Players {
		if m.Pending[i] == "" {
			m.Pending[i] = fixtureAutoAttack(m.Players[i])
			auto[i] = true
		}
	}
	m.resolve(auto)
	return true
}

// fixtureAutoAttack picks the lowest-cost attack the player can currently afford (its
// quick, zero-cost move in practice). It does not assume a particular attack
// order, so it stays correct if the catalog lists the heavy attack first.
func fixtureAutoAttack(player *Player) string {
	best := Attack{Cost: math.MaxInt}
	for _, attack := range player.Card.Attacks {
		if player.Energy >= attack.Cost && attack.Cost < best.Cost {
			best = attack
		}
	}
	if best.ID == "" { // no affordable attack (shouldn't happen: quick costs 0)
		return player.Card.Attacks[0].ID
	}
	return best.ID
}

func fixtureAvailableAttack(player *Player, id string) (Attack, bool) {
	for _, attack := range player.Card.Attacks {
		if attack.ID == id && player.Energy >= attack.Cost {
			return attack, true
		}
	}
	return Attack{}, false
}

// fixtureAttackDamage applies type effectiveness and same-type attack bonus (STAB).
// A non-immune hit always deals at least 1 damage.
func fixtureAttackDamage(attacker, defender *Player, atk Attack) (int, string) {
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

func (m *fixtureMatch) resolve(auto [2]bool) {
	var attacks [2]Attack
	var damage [2]int
	var effect [2]string
	for i := range m.Players {
		attacks[i], _ = fixtureAvailableAttack(m.Players[i], m.Pending[i])
		damage[i], effect[i] = fixtureAttackDamage(m.Players[i], m.Players[1-i], attacks[i])
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
