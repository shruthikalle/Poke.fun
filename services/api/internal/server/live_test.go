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
	if code, _ := h.call("GET", "/api/battles/"+id+"/events", "", "nope"); code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a bad token, got %d", code)
	}

	if code, out := h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, token); code != http.StatusOK {
		t.Fatalf("choice: %d %v", code, out)
	}
	turn, _ := h.events(id, token, cursor)
	if !strings.Contains(types(turn), "damage") || !strings.HasSuffix(types(turn), "win") {
		t.Fatalf("expected the AI battle to resolve and end, got %s", types(turn))
	}
	if code, _ := h.call("POST", "/api/battles/"+id+"/choice", `{"kind":"move","moveIndex":0}`, token); code != http.StatusConflict {
		t.Fatalf("expected 409 after the battle ended, got %d", code)
	}
}
