package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shruthikalle/Poke.fun/services/api/internal/arena"
)

func reconnectHarness(t *testing.T) (*Server, harness, *httptest.Server) {
	t.Helper()
	s := &Server{arenas: map[string]*arena.Game{}, peers: map[string]map[*arenaPeer]struct{}{}, origin: "http://localhost:3000"}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/arenas", s.createArena)
	mux.HandleFunc("POST /api/arenas/{id}/join", s.joinArena)
	mux.HandleFunc("GET /api/arenas/{id}", s.getArena)
	mux.HandleFunc("GET /api/arenas/{id}/ws", s.arenaSocket)
	mux.HandleFunc("POST /api/arenas/{id}/forfeit", s.arenaForfeit)
	host := httptest.NewServer(mux)
	t.Cleanup(func() { host.Close(); s.mu.Lock(); clear(s.arenas); s.mu.Unlock() })
	return s, harness{t, mux}, host
}

func openArenaSocket(t *testing.T, host, id, token string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(host, "http")+"/api/arenas/"+id+"/ws", http.Header{"Origin": []string{"http://localhost:3000"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.WriteJSON(map[string]string{"type": "auth", "token": token}); err != nil {
		t.Fatal(err)
	}
	return conn
}

func nextArenaView(t *testing.T, conn *websocket.Conn) arena.View {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var view arena.View
	if err := conn.ReadJSON(&view); err != nil {
		t.Fatal(err)
	}
	return view
}

func TestHTTPArenaReconnectKeepsTokensAndPausesDuringRefresh(t *testing.T) {
	s, h, host := reconnectHarness(t)
	_, alice := h.call("POST", "/api/arenas", `{"name":"Alice","cardId":"pikachu"}`, "")
	id, aliceToken := alice["id"].(string), alice["token"].(string)
	_, bob := h.call("POST", "/api/arenas/"+id+"/join", `{"name":"Bob","cardId":"charmander"}`, "")
	bobToken := bob["token"].(string)
	a := openArenaSocket(t, host.URL, id, aliceToken)
	first := nextArenaView(t, a)
	if first.Tick != 0 || first.Connected != [2]bool{true, false} {
		t.Fatalf("clock ran before both connected: %+v", first)
	}
	b := openArenaSocket(t, host.URL, id, bobToken)
	_ = nextArenaView(t, b)
	// Overlapping sockets during refresh share a player; closing the old socket
	// cannot clear the new one's input or begin a disconnect forfeit.
	refreshed := openArenaSocket(t, host.URL, id, aliceToken)
	_ = nextArenaView(t, refreshed)
	_ = a.Close()
	for i := 0; i < 3; i++ {
		v := nextArenaView(t, b)
		if !v.Connected[0] {
			t.Fatal("closing old socket disconnected refreshed player")
		}
	}
	_ = refreshed.Close()
	var paused arena.View
	for {
		paused = nextArenaView(t, b)
		if !paused.Connected[0] {
			break
		}
	}
	if paused.Winner != "" {
		t.Fatal("refresh immediately forfeited")
	}
	again := nextArenaView(t, b)
	if again.Tick != paused.Tick {
		t.Fatalf("paused combat advanced: %d -> %d", paused.Tick, again.Tick)
	}
	rejoined := openArenaSocket(t, host.URL, id, aliceToken)
	v := nextArenaView(t, rejoined)
	if v.You != 0 || v.Winner != "" || !v.Connected[0] {
		t.Fatal("same token did not resume the same side")
	}
	if code, _ := h.call("GET", "/api/arenas/"+id, "", "bad-token"); code != http.StatusUnauthorized {
		t.Fatalf("invalid credential status %d", code)
	}
	if code, res := h.call("GET", "/api/arenas/"+id, "", bobToken); code != http.StatusOK || res["you"] != float64(1) {
		t.Fatalf("opponent credential changed: %d %v", code, res)
	}
	s.mu.Lock()
	if s.arenas[id].Fighters[0].Token != aliceToken {
		t.Error("reconnect rotated token")
	}
	s.mu.Unlock()
}

func TestHTTPDisconnectGraceExpiryIsAuthoritative(t *testing.T) {
	s, h, _ := reconnectHarness(t)
	_, a := h.call("POST", "/api/arenas", `{"name":"Alice","cardId":"pikachu"}`, "")
	id, token := a["id"].(string), a["token"].(string)
	_, b := h.call("POST", "/api/arenas/"+id+"/join", `{"name":"Bob","cardId":"charmander"}`, "")
	s.mu.Lock()
	g := s.arenas[id]
	now := time.Now()
	g.Connect(0, now)
	g.Connect(1, now)
	g.Disconnect(0, now)
	// Advance the deadline rather than making this regression take 30 seconds.
	g.DisconnectDeadline[0] = now.Add(-time.Millisecond)
	s.mu.Unlock()
	code, result := h.call("GET", "/api/arenas/"+id, "", b["token"].(string))
	if code != http.StatusOK || result["winner"] != "player2" || result["endReason"] != "disconnect" {
		t.Fatalf("expiry: %d %v", code, result)
	}
	code, other := h.call("GET", "/api/arenas/"+id, "", token)
	if code != http.StatusOK || other["winner"] != result["winner"] {
		t.Fatalf("loser cannot resume final outcome: %d %v", code, other)
	}
}
