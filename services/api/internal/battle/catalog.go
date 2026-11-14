package battle

import (
	_ "embed"
	"encoding/json"
	"log"
)

type Attack struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Damage int    `json:"damage"`
	Cost   int    `json:"cost"`
	Gain   int    `json:"gain"`
}

type Card struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Element string   `json:"element"`
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
