package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shruthikalle/Poke.fun/services/api/internal/battle"
)

func TestCreateJoinAndAttack(t *testing.T) {
	handler := New("http://localhost:3000")
	charmander, _ := battle.FindCard("charmander")
	squirtle, _ := battle.FindCard("squirtle")
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
	created := call("POST", "/api/matches", `{"name":"Alice","cardId":"charmander"}`, "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var alice struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &alice); err != nil {
		t.Fatal(err)
	}
	joined := call("POST", "/api/matches/"+alice.ID+"/join", `{"name":"Bob","cardId":"squirtle"}`, "")
	if joined.Code != http.StatusOK {
		t.Fatalf("join: %d %s", joined.Code, joined.Body.String())
	}
	var bob struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(joined.Body.Bytes(), &bob); err != nil {
		t.Fatal(err)
	}
	first := call("POST", "/api/matches/"+alice.ID+"/attacks", `{"attackId":"`+charmander.Attacks[0].ID+`"}`, alice.Token)
	if first.Code != http.StatusOK {
		t.Fatalf("first attack: %d %s", first.Code, first.Body.String())
	}
	second := call("POST", "/api/matches/"+alice.ID+"/attacks", `{"attackId":"`+squirtle.Attacks[0].ID+`"}`, bob.Token)
	if second.Code != http.StatusOK {
		t.Fatalf("second attack: %d %s", second.Code, second.Body.String())
	}
	state := call("GET", "/api/matches/"+alice.ID, "", alice.Token)
	if state.Code != http.StatusOK {
		t.Fatalf("get: %d %s", state.Code, state.Body.String())
	}
	if bytes.Contains(state.Body.Bytes(), []byte(alice.Token)) || bytes.Contains(state.Body.Bytes(), []byte(bob.Token)) {
		t.Fatal("player token leaked into match view")
	}
	var view struct {
		Turn    int   `json:"turn"`
		History []any `json:"history"`
	}
	if err := json.Unmarshal(state.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.Turn != 2 || len(view.History) != 1 {
		t.Fatalf("turn did not resolve: %s", state.Body.String())
	}
}
