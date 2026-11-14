package battle

import "errors"

var (
	ErrInvalidCard   = errors.New("unknown card")
	ErrMatchFull     = errors.New("match is full")
	ErrNotReady      = errors.New("waiting for a second player")
	ErrFinished      = errors.New("match is finished")
	ErrInvalidAttack = errors.New("attack is unavailable")
	ErrAlreadyPlayed = errors.New("attack already submitted this turn")
)

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
	HP      [2]int    `json:"hp"`
}

type Match struct {
	ID      string
	Players [2]*Player
	Pending [2]string
	Turn    int
	Winner  string // "player1", "player2", "draw", or empty while playing
	History []Turn
}

type View struct {
	ID        string     `json:"id"`
	Status    string     `json:"status"`
	You       int        `json:"you"`
	Players   [2]*Player `json:"players"`
	Submitted [2]bool    `json:"submitted"`
	Turn      int        `json:"turn"`
	Winner    string     `json:"winner,omitempty"`
	History   []Turn     `json:"history"`
}

func NewMatch(id, name, cardID, token string) (*Match, error) {
	card, ok := FindCard(cardID)
	if !ok {
		return nil, ErrInvalidCard
	}
	return &Match{
		ID:      id,
		Players: [2]*Player{{Name: name, Card: card, HP: card.MaxHP, Token: token}, nil},
		Turn:    1,
		History: []Turn{},
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

func (m *Match) ViewFor(index int) View {
	status := "playing"
	if m.Players[1] == nil {
		status = "waiting"
	} else if m.Winner != "" {
		status = "finished"
	}
	var players [2]*Player
	for i, player := range m.Players {
		if player != nil {
			copy := *player
			copy.Token = ""
			players[i] = &copy
		}
	}
	return View{
		ID: m.ID, Status: status, You: index,
		Players:   players,
		Submitted: [2]bool{m.Pending[0] != "", m.Pending[1] != ""},
		Turn:      m.Turn, Winner: m.Winner, History: append([]Turn{}, m.History...),
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
		m.resolve()
	}
	return nil
}

func availableAttack(player *Player, id string) (Attack, bool) {
	for _, attack := range player.Card.Attacks {
		if attack.ID == id && player.Energy >= attack.Cost {
			return attack, true
		}
	}
	return Attack{}, false
}

func (m *Match) resolve() {
	var attacks [2]Attack
	var damage [2]int
	for i := range m.Players {
		attacks[i], _ = availableAttack(m.Players[i], m.Pending[i])
		damage[i] = attacks[i].Damage
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
		HP:      [2]int{m.Players[0].HP, m.Players[1].HP},
	})
	m.Pending = [2]string{}
	m.Turn++
	if m.Players[0].HP == 0 && m.Players[1].HP == 0 {
		m.Winner = "draw"
	} else if m.Players[0].HP == 0 {
		m.Winner = "player2"
	} else if m.Players[1].HP == 0 {
		m.Winner = "player1"
	}
}
