package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

type stubCollectibles struct {
	card collectibles.Card
	err  error
}

func (s stubCollectibles) Read(_ context.Context, _, _ string) (collectibles.Card, error) {
	return s.card, s.err
}

func TestQueueChecksSelectedNFT(t *testing.T) {
	card := collectibles.Card{ID: "asset", Owner: "wallet", Collection: "collection", Attributes: []collectibles.Attribute{
		{TraitType: "Category", Value: "Pokemon"}, {TraitType: "Card Name", Value: "Pikachu"},
	}}
	s := httptest.NewServer(NewWithCollectibles("http://localhost:3000", stubCollectibles{card: card}))
	defer s.Close()
	post := func(cardID string) int {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"name": "Alice", "cardId": cardID, "rating": 1500, "entryCents": 0, "assetId": "asset", "walletAddress": "wallet"})
		response, err := http.Post(s.URL+"/api/arena-queue", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		return response.StatusCode
	}
	if code := post("pikachu"); code != http.StatusCreated {
		t.Fatalf("valid NFT queue returned %d", code)
	}
	if code := post("charmander"); code != http.StatusForbidden {
		t.Fatalf("mismatched fighter returned %d", code)
	}
	response, err := http.Get(s.URL + "/api/collectibles/asset?owner=wallet")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("NFT read returned %d", response.StatusCode)
	}
}

func TestQueueMatchesNFTBySetAndNumber(t *testing.T) {
	// The printed name doesn't decide the fighter: Base Set #58 is a Pikachu card.
	card := collectibles.Card{ID: "asset", Owner: "wallet", Collection: "collection", Attributes: []collectibles.Attribute{
		{TraitType: "Category", Value: "Pokemon"}, {TraitType: "Card Name", Value: "Pikachu (Red Cheeks)"},
		{TraitType: "Set", Value: "Base Set"}, {TraitType: "Card Number", Value: "58/102"},
	}}
	s := httptest.NewServer(NewWithCollectibles("http://localhost:3000", stubCollectibles{card: card}))
	defer s.Close()
	post := func(cardID string) int {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"name": "Alice", "cardId": cardID, "rating": 1500, "entryCents": 0, "assetId": "asset", "walletAddress": "wallet"})
		response, err := http.Post(s.URL+"/api/arena-queue", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		return response.StatusCode
	}
	if code := post("pikachu"); code != http.StatusCreated {
		t.Fatalf("card mapped by set and number returned %d", code)
	}
	if code := post("raichu"); code != http.StatusForbidden {
		t.Fatalf("a different fighter for the same NFT returned %d", code)
	}
}
