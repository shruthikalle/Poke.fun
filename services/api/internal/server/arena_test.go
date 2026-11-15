package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
)

func TestTwoClientsShareLiveArena(t *testing.T) {
	const origin = "http://localhost:3000"
	httpServer := httptest.NewServer(New(origin))
	defer httpServer.Close()
	create := func(path, body string) struct{ ID, Token string } {
		t.Helper()
		res, err := http.Post(httpServer.URL+path, "application/json", bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusOK {
			t.Fatalf("POST %s: %s", path, res.Status)
		}
		var session struct{ ID, Token string }
		if err := json.NewDecoder(res.Body).Decode(&session); err != nil {
			t.Fatal(err)
		}
		return session
	}
	alice := create("/api/arenas", `{"name":"Alice","cardId":"pikachu"}`)
	bob := create("/api/arenas/"+alice.ID+"/join", `{"name":"Bob","cardId":"charmander"}`)
	dial := func(token string) *websocket.Conn {
		t.Helper()
		url := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/api/arenas/" + alice.ID + "/ws"
		conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{origin}})
		if err != nil {
			t.Fatal(err)
		}
		if err := conn.WriteJSON(map[string]string{"type": "auth", "token": token}); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	a := dial(alice.Token)
	b := dial(bob.Token)
	defer a.Close()
	defer b.Close()
	read := func(conn *websocket.Conn) arena.View {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		var view arena.View
		if err := conn.ReadJSON(&view); err != nil {
			t.Fatal(err)
		}
		return view
	}
	if view := read(a); view.You != 0 || view.Fighters[0].Token != "" || view.Fighters[1].Token != "" {
		t.Fatal("Alice view is incorrect or leaks tokens")
	}
	if view := read(b); view.You != 1 {
		t.Fatal("Bob received wrong perspective")
	}
	if err := a.WriteJSON(arena.Input{DX: 1}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		view := read(b)
		if view.Fighters[0].X > 120 {
			return
		}
	}
	t.Fatal("Bob never saw Alice move")
}
