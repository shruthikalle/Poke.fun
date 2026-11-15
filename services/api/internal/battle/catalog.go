package battle

import (
	_ "embed"
	"encoding/json"
	"log"
)

// RulesVersion is the version of the combat rules (damage, effectiveness,
// energy and timeout handling). A match locks this value when it starts so a
// later rules change cannot alter an active match (PRD §8).
const RulesVersion = "1.0.0"

// CatalogVersion identifies the card definitions a match was played with.
const CatalogVersion = "2026.11-sample"

type Attack struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Element is the attack's damage type. Empty is treated as "Normal".
	Element Element `json:"element"`
	Damage  int     `json:"damage"`
	Cost    int     `json:"cost"`
	Gain    int     `json:"gain"`
}

type Card struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Element Element  `json:"element"`
	MaxHP   int      `json:"maxHp"`
	Attacks []Attack `json:"attacks"`
}

//go:embed cards.json
var cardData []byte

var cards []Card

func init() {
	if err := json.Unmarshal(cardData, &cards); err != nil {
		log.Fatalf("load card catalog: %v", err)
	}
}

func Cards() []Card {
	return cards
}

func FindCard(id string) (Card, bool) {
	for _, card := range cards {
		if card.ID == id {
			return card, true
		}
	}
	return Card{}, false
}
