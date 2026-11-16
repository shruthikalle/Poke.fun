package battle

import "github.com/shruthikalle/Poke.fun/services/api/internal/pokedex"

// These versions are locked when a duel starts. cards.json is retained only as
// a historical fixture; active definitions come exclusively from the Pokédex.
const RulesVersion = "2.0.0-pokemon-duel"

var CatalogVersion = pokedex.Version()

const DuelLevel = 50

type Attack struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Element  Element `json:"element"`
	Category string  `json:"category"`
	Power    int     `json:"power"`
	// Damage previews a neutral hit against 70 defence, before STAB/matchups.
	Damage int `json:"damage"`
	Cost   int `json:"cost"`
	Gain   int `json:"gain"`
}

type Card struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Element Element       `json:"element"`
	Types   []string      `json:"types"`
	Tier    int           `json:"tier"`
	Level   int           `json:"level"`
	Stats   pokedex.Stats `json:"stats"`
	Sprite  string        `json:"sprite"`
	MaxHP   int           `json:"maxHp"`
	Attacks []Attack      `json:"attacks"`
}

var cards, cardsByID = buildCatalog()

func buildCatalog() ([]Card, map[string]Card) {
	out := make([]Card, 0, len(pokedex.All()))
	index := make(map[string]Card, len(pokedex.All()))
	for _, s := range pokedex.All() {
		c := Card{ID: s.Key, Name: s.Name, Element: Element(s.Types[0]), Types: append([]string(nil), s.Types...),
			Tier: s.Tier, Level: DuelLevel, Stats: s.StatsAt(DuelLevel), Sprite: s.Sprite}
		c.MaxHP = c.Stats.HP
		for i, m := range duelMoves(s) {
			a := Attack{ID: m.ID, Name: m.Name, Element: Element(m.Type), Category: m.Category, Power: m.Power}
			if i == 0 {
				a.Gain = 1
			} else {
				a.Cost = 2
			}
			a.Damage = baseDamage(c, a, 70)
			c.Attacks = append(c.Attacks, a)
		}
		out, index[c.ID] = append(out, c), c
	}
	return out, index
}

// Cards returns the read-only active roster, ordered by National Dex number.
func Cards() []Card { return cards }

func FindCard(id string) (Card, bool) {
	card, ok := cardsByID[id]
	return card, ok
}
