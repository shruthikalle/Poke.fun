package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/resultstore"
)

// ownedCards is an NFT reader keyed by asset ID: asset -> {owner, card name}.
type ownedCards map[string][2]string

func (o ownedCards) Read(_ context.Context, id, _ string) (collectibles.Card, error) {
	owned, ok := o[id]
	if !ok {
		return collectibles.Card{}, collectibles.ErrNotFound
	}
	return collectibles.Card{ID: id, Owner: owned[0], Attributes: []collectibles.Attribute{
		{TraitType: "Category", Value: "Pokemon"}, {TraitType: "Card Name", Value: owned[1]},
	}}, nil
}

func termsHarness(t *testing.T) (harness, *Server) {
	t.Helper()
	h, err := NewWithConfig(Config{Origin: "http://localhost:3000", Collectibles: ownedCards{
		"pika-nft": {"wallet-a", "Pikachu"}, "eevee-nft": {"wallet-a", "Eevee"}, "ditto-nft": {"wallet-b", "Ditto"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return harness{t, h}, h.server
}

func TestVerifiedCardCannotBackTwoActiveEntries(t *testing.T) {
	h, _ := termsHarness(t)
	owned := `"assetId":"pika-nft","walletAddress":"wallet-a"`
	code, first := h.call("POST", "/api/arena-queue", `{"name":"Alice","cardId":"pikachu",`+owned+`}`, "")
	if code != http.StatusCreated {
		t.Fatalf("queue: %d %v", code, first)
	}
	// Neither another name, another queue nor a private arena may reuse it.
	if code, out := h.call("POST", "/api/arena-queue", `{"name":"Mallory","cardId":"pikachu",`+owned+`}`, ""); code != http.StatusConflict {
		t.Fatalf("second arena entry: %d %v", code, out)
	}
	if code, out := h.call("POST", "/api/arenas", `{"name":"Mallory","cardId":"pikachu",`+owned+`}`, ""); code != http.StatusConflict {
		t.Fatalf("private arena reuse: %d %v", code, out)
	}
	team := `{"trainer":{"name":"Mallory"},"format":"champion","tier":1,"entry":0,"team":[{"species":"pikachu",` + owned + `}]}`
	if code, out := h.call("POST", "/api/queue", team, ""); code != http.StatusConflict {
		t.Fatalf("team queue reuse: %d %v", code, out)
	}
	// Rentals of the same species are unaffected.
	if code, out := h.call("POST", "/api/arena-queue", `{"name":"Bob","cardId":"pikachu"}`, ""); code != http.StatusCreated {
		t.Fatalf("rental: %d %v", code, out)
	}
	// Bob's rental paired with Alice; the match now holds her card.
	if _, status := h.call("GET", "/api/arena-queue/"+first["id"].(string), "", first["token"].(string)); status["status"] != "matched" {
		t.Fatalf("poll: %v", status)
	}
	if code, out := h.call("POST", "/api/arena-queue", `{"name":"Alice","cardId":"pikachu",`+owned+`}`, ""); code != http.StatusConflict {
		t.Fatalf("card reused during match: %d %v", code, out)
	}
}

func TestArenaResultSealsEntryAndVerifiedCards(t *testing.T) {
	h, _ := termsHarness(t)
	code, alice := h.call("POST", "/api/arena-queue", `{"name":"Alice","cardId":"pikachu","entryCents":250,"assetId":"pika-nft","walletAddress":"wallet-a"}`, "")
	if code != http.StatusCreated {
		t.Fatalf("queue: %d %v", code, alice)
	}
	code, bob := h.call("POST", "/api/arena-queue", `{"name":"Bob","cardId":"charmander","entryCents":250}`, "")
	if code != http.StatusCreated || bob["status"] != "matched" {
		t.Fatalf("pair: %d %v", code, bob)
	}
	arenaInfo := bob["arena"].(map[string]any)
	id, bobToken := arenaInfo["id"].(string), arenaInfo["token"].(string)
	if code, out := h.call("POST", "/api/arenas/"+id+"/forfeit", "", bobToken); code != http.StatusOK {
		t.Fatalf("forfeit: %d %v", code, out)
	}
	req, _ := http.NewRequest("GET", "/api/arenas/"+id+"/result", nil)
	req.Header.Set("Authorization", "Bearer "+bobToken)
	w := recorder(h, req)
	var envelope resultstore.Envelope
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &envelope) != nil || !resultstore.Verify(envelope) {
		t.Fatalf("result: %d %s", w.Code, w.Body.String())
	}
	result := envelope.Result
	if result.EntryCents != 250 || result.Winner != "p1" || result.Funding != "unfunded" {
		t.Fatalf("terms not sealed: %+v", result)
	}
	if !reflect.DeepEqual(result.Players[0].Assets, []string{"pika-nft"}) || result.Players[1].Assets != nil {
		t.Fatalf("eligibility not sealed: %+v", result.Players)
	}
	// The finished match released the card.
	if code, out := h.call("POST", "/api/arena-queue", `{"name":"Alice","cardId":"pikachu","assetId":"pika-nft","walletAddress":"wallet-a"}`, ""); code != http.StatusCreated {
		t.Fatalf("card still held after the match: %d %v", code, out)
	}
}

func TestTeamQueueRecordsTermsAndRequiresOneWallet(t *testing.T) {
	h, s := termsHarness(t)
	mixed := `{"trainer":{"name":"Ash"},"format":"squad","tier":1,"entry":1.5,"team":[
		{"species":"pikachu","assetId":"pika-nft","walletAddress":"wallet-a"},
		{"species":"ditto","assetId":"ditto-nft","walletAddress":"wallet-b"},{"species":"charmander"}]}`
	if code, out := h.call("POST", "/api/queue", mixed, ""); code != http.StatusBadRequest {
		t.Fatalf("mixed wallets accepted: %d %v", code, out)
	}
	owned := `{"trainer":{"name":"Ash"},"format":"squad","tier":1,"entry":1.5,"team":[
		{"species":"pikachu","assetId":"pika-nft","walletAddress":"wallet-a"},
		{"species":"charmander"},{"species":"eevee","assetId":"eevee-nft","walletAddress":"wallet-a"}]}`
	if code, out := h.call("POST", "/api/queue", owned, ""); code != http.StatusAccepted {
		t.Fatalf("owned squad: %d %v", code, out)
	}
	code, paired := h.call("POST", "/api/queue", `{"trainer":{"name":"Misty"},"format":"squad","tier":1,"entry":1.5,"team":[{"species":"squirtle"},{"species":"bulbasaur"},{"species":"eevee"}]}`, "")
	if code != http.StatusOK {
		t.Fatalf("pair: %d %v", code, paired)
	}
	terms := s.terms[teamTermsKey(paired["id"].(string))]
	want := matchTerms{EntryCents: 150, Seats: [2]seatTerms{{Assets: []string{"pika-nft", "", "eevee-nft"}}, {Assets: []string{"", "", ""}}}}
	if !reflect.DeepEqual(terms, want) {
		t.Fatalf("terms = %+v, want %+v", terms, want)
	}
	// Opponents never receive verification credentials.
	raw, _ := json.Marshal(paired)
	if strings.Contains(string(raw), "pika-nft") {
		t.Fatalf("asset leaked to the opponent: %s", raw)
	}
}

func TestTermsSurviveCheckpointRestore(t *testing.T) {
	h, s := termsHarness(t)
	h.call("POST", "/api/arena-queue", `{"name":"Alice","cardId":"pikachu","entryCents":100,"assetId":"pika-nft","walletAddress":"wallet-a"}`, "")
	h.call("POST", "/api/arena-queue", `{"name":"Bob","cardId":"charmander","entryCents":100}`, "")
	h.call("POST", "/api/arena-queue", `{"name":"Cara","cardId":"eevee","assetId":"eevee-nft","walletAddress":"wallet-a"}`, "")
	s.mu.Lock()
	raw, err := json.Marshal(s.snapshotLocked())
	want := s.terms
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	restored := &Server{}
	if err := restored.restoreLocked(raw); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.terms, want) || len(restored.terms) != 1 {
		t.Fatalf("terms = %+v, want %+v", restored.terms, want)
	}
	if !restored.activeAssetsLocked()["eevee-nft"] || !restored.activeAssetsLocked()["pika-nft"] {
		t.Fatal("restored searches and matches no longer hold their cards")
	}
}

func recorder(h harness, req *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, req)
	return w
}
