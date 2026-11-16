package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestQueueValidatesCanonicalSelections(t *testing.T) {
	cases := []struct {
		name, format string
		tier         int
		entry        float64
		team         []queuePick
	}{
		{"unknown species", "champion", 1, 0, []queuePick{{Species: "fictional"}}},
		{"tier spoof", "champion", 1, 0, []queuePick{{Species: "charizard"}}},
		{"invalid format", "duo", 1, 0, []queuePick{{Species: "pikachu"}}},
		{"short squad", "squad", 1, 0, []queuePick{{Species: "pikachu"}}},
		{"duplicate species", "squad", 1, 0, []queuePick{{Species: "pikachu"}, {Species: "pikachu"}, {Species: "eevee"}}},
		{"duplicate forms", "squad", 3, 0, []queuePick{{Species: "charizard"}, {Species: "charizard-mega-x"}, {Species: "eevee"}}},
		{"level spoof", "champion", 1, 0, []queuePick{{Species: "pikachu", Level: 100}}},
		{"negative entry", "champion", 1, -1, []queuePick{{Species: "pikachu"}}},
		{"subcent entry", "champion", 1, 0.001, []queuePick{{Species: "pikachu"}}},
		{"bench tier spoof", "squad", 1, 0, []queuePick{{Species: "pikachu"}, {Species: "eevee"}, {Species: "charizard"}}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			h := harness{t, New("http://localhost:3000")}
			req := queueRequest{Format: tt.format, Tier: tt.tier, Entry: tt.entry, Team: tt.team}
			req.Trainer.Name = "Ash"
			raw, _ := json.Marshal(req)
			if code, out := h.call("POST", "/api/queue", string(raw), ""); code != http.StatusBadRequest {
				t.Fatalf("invalid queue accepted: %d %v", code, out)
			}
		})
	}
}

func TestQueueReturnsRealRecordsAndRetryableMatchedTicket(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	join := func(name string) (int, map[string]any) {
		return h.call("POST", "/api/queue", `{"trainer":{"name":"`+name+`"},"rating":999999,"format":"champion","tier":1,"entry":5,"team":[{"species":"ditto","level":50,"tier":3}]}`, "")
	}
	code, first := join("Ash")
	if code != http.StatusAccepted {
		t.Fatalf("join: %d %v", code, first)
	}
	code, second := join("Misty")
	if code != http.StatusOK {
		t.Fatalf("pair: %d %v", code, second)
	}
	opponent := second["opponent"].(map[string]any)
	if opponent["rating"] != float64(1200) || opponent["wins"] != float64(0) || opponent["losses"] != float64(0) {
		t.Fatalf("not server records: %v", opponent)
	}
	pick := opponent["team"].([]any)[0].(map[string]any)
	if pick["tier"] != float64(1) || pick["level"] != float64(50) {
		t.Fatalf("not canonical pick: %v", pick)
	}
	path := "/api/queue/" + first["ticket"].(string)
	h.call("DELETE", path, "", "") // cancellation racing pairing must not discard it
	for i := 0; i < 2; i++ {
		if code, reply := h.call("GET", path, "", ""); code != http.StatusOK || reply["id"] != second["id"] {
			t.Fatalf("match not retryable: %d %v", code, reply)
		}
	}
	id := second["id"].(string)
	token := second["token"].(string)
	for turns := 0; turns < 10; turns++ {
		_, one := h.call("GET", path, "", "")
		a := one["token"].(string)
		h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, a)
		code, _ := h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, token)
		if code == http.StatusConflict {
			break
		}
	}
	for i := 0; i < 2; i++ {
		h.events(id, token, 0)
	}
	_, ash := h.call("GET", "/api/ranks?player=Ash", "", "")
	_, misty := h.call("GET", "/api/ranks?player=Misty", "", "")
	games := func(rank map[string]any) float64 {
		return rank["wins"].(float64) + rank["losses"].(float64) + rank["draws"].(float64)
	}
	if games(ash) != 1 || games(misty) != 1 {
		t.Fatalf("result must record once: %v %v", ash, misty)
	}
}

func TestSpeciesEndpointSharesBattleMoves(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	code, ditto := h.call("GET", "/api/species/ditto", "", "")
	if code != http.StatusOK {
		t.Fatalf("species: %d %v", code, ditto)
	}
	moves := ditto["moves"].([]any)
	if len(moves) != 1 || moves[0].(map[string]any)["id"] != "struggle" {
		t.Fatalf("moveless species: %v", moves)
	}
	if code, _ := h.call("GET", "/api/species/fictional", "", ""); code != http.StatusNotFound {
		t.Fatalf("unknown species: %d", code)
	}
}
