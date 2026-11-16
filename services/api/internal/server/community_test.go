package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/playerstore"
)

func communityCall(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestCommunitySharedChatAndPresence(t *testing.T) {
	h := New("http://localhost:3000")
	call := func(method, path, body, token string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := communityCall(h, method, path, body, token)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	initial := call("GET", "/api/community", "", "", 200)
	if !strings.Contains(initial.Body.String(), `"usersOnline":0`) || !strings.Contains(initial.Body.String(), `"liveBattles":[]`) {
		t.Fatal(initial.Body.String())
	}
	join := func(name string) string {
		t.Helper()
		w := call("POST", "/api/community/presence", `{"name":"`+name+`","roomId":"lobby"}`, "", 200)
		var p struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
			t.Fatal(err)
		}
		return p.Token
	}
	alice, bob := join("Alice"), join("Bob")
	join("Alice") // another tab must not inflate the public-name count
	snapshot := call("GET", "/api/community", "", "", 200)
	if !strings.Contains(snapshot.Body.String(), `"usersOnline":2`) || !strings.Contains(snapshot.Body.String(), `"users":2`) {
		t.Fatal(snapshot.Body.String())
	}
	call("GET", "/api/community/rooms/lobby/messages", "", "", 200)
	call("POST", "/api/community/rooms/lobby/messages", `{"text":"hi"}`, "", 401)
	call("POST", "/api/community/rooms/lobby/messages", `{"user":"Bob","text":"spoof"}`, alice, 400)
	sent := call("POST", "/api/community/rooms/lobby/messages", `{"text":"Hello Bob"}`, alice, 201)
	var msg roomMessage
	if err := json.Unmarshal(sent.Body.Bytes(), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.User != "Alice" || msg.ID != 1 {
		t.Fatal(sent.Body.String())
	}
	poll := call("GET", "/api/community/rooms/lobby/messages?since=0", "", bob, 200)
	if !strings.Contains(poll.Body.String(), "Hello Bob") {
		t.Fatal("second client did not receive shared message")
	}
	empty := call("GET", "/api/community/rooms/lobby/messages?since=1", "", bob, 200)
	if !strings.Contains(empty.Body.String(), `"messages":[]`) {
		t.Fatal("cursor replayed message")
	}
	call("POST", "/api/community/rooms/help/messages", `{"text":"hi"}`, bob, 403)
	call("POST", "/api/community/presence", `{"name":"Bob","roomId":"help"}`, bob, 200)
	call("POST", "/api/community/rooms/help/messages", `{"text":"help?"}`, bob, 201)
	call("GET", "/api/community/rooms/imaginary/messages", "", "", 404)
	call("GET", "/api/community/rooms/lobby/messages?since=-1", "", "", 400)
	call("DELETE", "/api/community/presence", "", bob, 204)
	call("POST", "/api/community/rooms/lobby/messages", `{"text":"gone"}`, bob, 401)
}

func TestPresenceExpiryAndBoundedHistory(t *testing.T) {
	s := &Server{community: newCommunity()}
	s.community.presence["expired"] = &communityPresence{name: "Alice", seen: time.Now().Add(-presenceTTL - time.Second), rooms: map[string]time.Time{"lobby": time.Now()}}
	s.community.presence["current"] = &communityPresence{name: "Bob", seen: time.Now(), rooms: map[string]time.Time{"lobby": time.Now().Add(-presenceTTL - time.Second)}}
	s.prunePresence(time.Now())
	if len(s.community.presence) != 1 || len(s.community.presence["current"].rooms) != 0 {
		t.Fatal("stale presence or room membership counted")
	}
	s.community.presence["current"].rooms["lobby"] = time.Now()
	for i := 0; i < 205; i++ {
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{"text":"hello"}`))
		r.SetPathValue("room", "lobby")
		r.Header.Set("Authorization", "Bearer current")
		w := httptest.NewRecorder()
		s.sendRoomMessage(w, r)
		if w.Code != 201 {
			t.Fatal(w.Body.String())
		}
	}
	if len(s.community.messages["lobby"]) != roomHistoryLimit || s.community.messages["lobby"][0].ID != 6 {
		t.Fatal("unbounded history")
	}
}

func TestRanksAreReadOnlyServerRecords(t *testing.T) {
	store, _ := playerstore.Open("")
	h := NewWithPlayerStore("", nil, store)
	fresh := communityCall(h, "GET", "/api/ranks?player=Alice", "", "unused")
	if fresh.Code != 200 || !strings.Contains(fresh.Body.String(), `"rating":1200`) || !strings.Contains(fresh.Body.String(), `"wins":0`) {
		t.Fatal(fresh.Body.String())
	}
	if w := communityCall(h, "POST", "/api/ranks", `{"player":"Alice","wins":9000}`, ""); w.Code != 405 {
		t.Fatalf("client writes accepted: %d", w.Code)
	}
	if w := communityCall(h, "GET", "/api/ranks?player=", "", ""); w.Code != 400 {
		t.Fatal("invalid name accepted")
	}
	if err := store.Record("arena:one", "Alice", "Bob", "p1"); err != nil {
		t.Fatal(err)
	}
	leaders := communityCall(h, "GET", "/api/leaderboard", "", "")
	if !strings.Contains(leaders.Body.String(), `"name":"Alice","rating":1216`) || !strings.Contains(leaders.Body.String(), "not verified") {
		t.Fatal(leaders.Body.String())
	}
}
