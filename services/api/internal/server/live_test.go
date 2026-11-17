package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// creatureJSON builds one creature payload as the web client would send it.
func creatureJSON(id, species, typ string, hp, speed, power int) string {
	return `{"id":"` + id + `","species":"` + species + `","spriteId":"` + species + `",
	  "sprites":{"front":"f","back":"b","frontStatic":"fs","backStatic":"bs"},
	  "speed":` + itoa(speed) + `,"stats":{"atk":84,"def":78,"spa":109,"spd":85},"cardArt":null,
	  "level":50,"gender":null,"types":["` + typ + `"],"hp":` + itoa(hp) + `,"maxHp":` + itoa(hp) + `,"fainted":false,
	  "moves":[{"id":"m","name":"Hit","type":"` + typ + `","category":"special","power":` + itoa(power) + `,"accuracy":100,"pp":15,"maxPp":15}]}`
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

type harness struct {
	t       *testing.T
	handler http.Handler
}

func (h harness) call(method, path, body, token string) (int, map[string]any) {
	h.t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

// events polls the feed from the given cursor and returns the event types.
func (h harness) events(id, token string, since int) ([]map[string]any, int) {
	h.t.Helper()
	code, out := h.call("GET", "/api/battles/"+id+"/events?since="+itoa(since), "", token)
	if code != http.StatusOK {
		h.t.Fatalf("events: %d %v", code, out)
	}
	raw, _ := out["events"].([]any)
	events := make([]map[string]any, len(raw))
	for i, e := range raw {
		events[i] = e.(map[string]any)
	}
	return events, int(out["cursor"].(float64))
}

func types(events []map[string]any) string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i], _ = e["type"].(string)
	}
	return strings.Join(out, ",")
}

func TestLiveBattleAgainstAI(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	setup := `{"you":{"id":"you","name":"You","avatar":"maya"},"opponent":{"id":"opp","name":"Opp","avatar":"kai"},
	  "format":{"name":"Test","rated":true,"rules":[]},"seed":99,
	  "teams":{"p1":[` + creatureJSON("a", "charizard", "Fire", 153, 200, 120) + `],
	           "p2":[` + creatureJSON("b", "venusaur", "Grass", 10, 80, 90) + `]}}`

	code, created := h.call("POST", "/api/battles", setup, "")
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, created)
	}
	id, token := created["id"].(string), created["token"].(string)
	open, cursor := h.events(id, token, 0)
	if !strings.HasPrefix(types(open), "init,") {
		t.Fatalf("feed should open with init, got %s", types(open))
	}
	if code, out := h.call("GET", "/api/battles/"+id+"/events?since="+itoa(cursor), "", token); code != http.StatusOK {
		t.Fatalf("empty feed: %d %v", code, out)
	} else if _, ok := out["events"].([]any); !ok {
		t.Fatalf("empty feed must encode events as [], got %v", out["events"])
	}
	if code, _ := h.call("GET", "/api/battles/"+id+"/events", "", "nope"); code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a bad token, got %d", code)
	}

	// The server ignores the supplied HP, speed and move definitions.
	state := open[0]["state"].(map[string]any)
	side := state["sides"].(map[string]any)["p2"].(map[string]any)
	canonical := side["team"].([]any)[0].(map[string]any)
	if canonical["maxHp"].(float64) <= 10 {
		t.Fatal("client HP was trusted")
	}
	won := false
	for turn := 0; turn < 100; turn++ {
		if code, out := h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, token); code != http.StatusOK {
			t.Fatalf("choice: %d %v", code, out)
		}
		events, next := h.events(id, token, cursor)
		cursor = next
		if !strings.Contains(types(events), "damage") {
			t.Fatalf("expected resolved damage: %s", types(events))
		}
		if strings.Contains(types(events), "win") {
			won = true
			break
		}
	}
	if !won {
		t.Fatal("canonical AI battle failed to finish")
	}

	if code, _ := h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, token); code != http.StatusConflict {
		t.Fatalf("expected 409 after the battle ended, got %d", code)
	}
}

func TestTwoPlayerBattleThroughMatchmaking(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	join := func(name string) (int, map[string]any) {
		return h.call("POST", "/api/queue", `{"trainer":{"id":"`+name+`","name":"`+name+`","avatar":"maya"},
		  "rating":1500,"format":"champion","tier":1,"entry":5,"team":[{"species":"pikachu"}]}`, "")
	}

	// The first player waits; a different stake must not pair with them.
	code, ash := join("Ash")
	if code != http.StatusAccepted || ash["status"] != "searching" {
		t.Fatalf("first player should be searching: %d %v", code, ash)
	}
	if code, other := h.call("POST", "/api/queue", `{"trainer":{"id":"x","name":"Gary","avatar":"kai"},
	  "rating":1500,"format":"champion","tier":1,"entry":25,"team":[{"species":"eevee"}]}`, ""); code != http.StatusAccepted {
		t.Fatalf("a different entry should not be paired: %d %v", code, other)
	}

	// The second compatible player is paired immediately as p2.
	code, misty := join("Misty")
	if code != http.StatusOK || misty["status"] != "matched" || misty["side"] != "p2" {
		t.Fatalf("second player should be matched as p2: %d %v", code, misty)
	}
	_, ashMatch := h.call("GET", "/api/queue/"+ash["ticket"].(string), "", "")
	if ashMatch["status"] != "matched" || ashMatch["side"] != "p1" || ashMatch["id"] != misty["id"] {
		t.Fatalf("first player should be matched into the same battle as p1: %v", ashMatch)
	}
	if opp := ashMatch["opponent"].(map[string]any)["trainer"].(map[string]any)["name"]; opp != "Misty" {
		t.Fatalf("p1 should see p2's trainer, got %v", opp)
	}

	id := misty["id"].(string)
	p1, p2 := ashMatch["token"].(string), misty["token"].(string)
	team := func(c string) string {
		return `{"team":[` + c + `],"format":{"name":"Online","rated":true,"rules":[]}}`
	}

	// Queue picks are already locked; subsequent setup can only reconnect.
	if code, _ := h.call("POST", "/api/battles/"+id+"/team", team(creatureJSON("a", "charizard", "Fire", 9999, 9999, 9999)), p1); code != http.StatusBadRequest {
		t.Fatalf("team substitution accepted: %d", code)
	}
	if code, out := h.call("POST", "/api/battles/"+id+"/team", team(creatureJSON("a", "pikachu", "Fire", 9999, 9999, 9999)), p1); code != http.StatusOK {
		t.Fatalf("same team reconnect: %d %v", code, out)
	}

	open1, c1 := h.events(id, p1, 0)
	open2, c2 := h.events(id, p2, 0)
	if types(open1) != types(open2) || !strings.HasPrefix(types(open1), "init,") {
		t.Fatalf("both players should see the same opening: %s vs %s", types(open1), types(open2))
	}

	// p1's hidden choice must not reveal anything; the turn resolves on p2's.
	h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, p1)
	if evs, _ := h.events(id, p2, c2); len(evs) != 0 {
		t.Fatalf("p1's choice leaked to p2: %s", types(evs))
	}
	if code, out := h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, p2); code != http.StatusOK {
		t.Fatalf("p2 choice: %d %v", code, out)
	}
	turn1, _ := h.events(id, p1, c1)
	turn2, _ := h.events(id, p2, c2)
	if types(turn1) != types(turn2) || strings.Count(types(turn1), "move") < 1 {
		t.Fatalf("both players should see the same resolved turn with two moves: %s vs %s", types(turn1), types(turn2))
	}

	// A player's token only controls their own side, and rematch waits for the end.
	if code, _ := h.call("POST", "/api/battles/"+id+"/rematch", `{}`, p1); code != http.StatusConflict {
		t.Fatalf("rematch mid-battle should be refused, got %d", code)
	}
}
