package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const battleSetup = `{
  "you": {"id":"you","name":"You","avatar":"maya"},
  "opponent": {"id":"opp","name":"Opp","avatar":"kai"},
  "format": {"name":"[Gen 9] Test","rated":true,"rules":[]},
  "seed": 99,
  "teams": {
    "p1": [{"id":"p1-0","species":"charizard","spriteId":"charizard","sprites":{"front":"f","back":"b","frontStatic":"fs","backStatic":"bs"},"speed":200,"stats":{"atk":84,"def":78,"spa":109,"spd":85},"cardArt":null,"level":50,"gender":null,"types":["Fire"],"hp":153,"maxHp":153,"fainted":false,"moves":[{"id":"flamethrower","name":"Flamethrower","type":"Fire","category":"special","power":120,"accuracy":100,"pp":15,"maxPp":15}]}],
    "p2": [{"id":"p2-0","species":"venusaur","spriteId":"venusaur","sprites":{"front":"f","back":"b","frontStatic":"fs","backStatic":"bs"},"speed":80,"stats":{"atk":82,"def":83,"spa":100,"spd":100},"cardArt":null,"level":50,"gender":null,"types":["Grass","Poison"],"hp":10,"maxHp":10,"fainted":false,"moves":[{"id":"sludge","name":"Sludge Bomb","type":"Poison","category":"special","power":90,"accuracy":100,"pp":10,"maxPp":10}]}]
  }
}`

func TestLiveBattleCreateAndPlay(t *testing.T) {
	handler := New("http://localhost:3000")
	call := func(method, path, body, token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}

	created := call("POST", "/api/battles", battleSetup, "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var open struct {
		ID     string           `json:"id"`
		Token  string           `json:"token"`
		Events []map[string]any `json:"events"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &open); err != nil {
		t.Fatal(err)
	}
	if open.Events[0]["type"] != "init" {
		t.Fatalf("first event should be init, got %v", open.Events[0]["type"])
	}

	// A wrong token is rejected.
	if bad := call("POST", "/api/battles/"+open.ID+"/choice", `{"kind":"move","moveIndex":0}`, "nope"); bad.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for bad token, got %d", bad.Code)
	}

	// The fast Fire attacker should KO the frail Grass defender.
	played := call("POST", "/api/battles/"+open.ID+"/choice", `{"kind":"move","moveIndex":0}`, open.Token)
	if played.Code != http.StatusOK {
		t.Fatalf("choice: %d %s", played.Code, played.Body.String())
	}
	var res struct {
		Events []map[string]any `json:"events"`
	}
	if err := json.Unmarshal(played.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	var sawSuper, sawWin bool
	for _, e := range res.Events {
		if e["type"] == "damage" && e["side"] == "p2" && e["effectiveness"] == "super" {
			sawSuper = true
		}
		if e["type"] == "win" && e["winner"] == "p1" {
			sawWin = true
		}
	}
	if !sawSuper {
		t.Fatalf("expected a super-effective hit on p2: %s", played.Body.String())
	}
	if !sawWin {
		t.Fatalf("expected p1 to win: %s", played.Body.String())
	}

	// After the battle ends, another choice conflicts.
	if done := call("POST", "/api/battles/"+open.ID+"/choice", `{"kind":"move","moveIndex":0}`, open.Token); done.Code != http.StatusConflict {
		t.Fatalf("expected 409 after battle end, got %d", done.Code)
	}
}
