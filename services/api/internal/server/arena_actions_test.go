package server

import (
	"net/http"
	"testing"
)

func TestArenaForfeitAuthenticatesAndSharesFinalResult(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	code, alice := h.call("POST", "/api/arenas", `{"name":"Alice","cardId":"pikachu"}`, "")
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, alice)
	}
	id, aliceToken := alice["id"].(string), alice["token"].(string)
	code, bob := h.call("POST", "/api/arenas/"+id+"/join", `{"name":"Bob","cardId":"charmander"}`, "")
	if code != http.StatusOK {
		t.Fatalf("join: %d %v", code, bob)
	}
	bobToken := bob["token"].(string)
	if code, _ := h.call("POST", "/api/arenas/"+id+"/forfeit", "", "invalid"); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated forfeit: %d", code)
	}
	code, result := h.call("POST", "/api/arenas/"+id+"/forfeit", "", aliceToken)
	if code != http.StatusOK || result["winner"] != "player2" || result["status"] != "finished" {
		t.Fatalf("forfeit result: %d %v", code, result)
	}
	code, opponentView := h.call("GET", "/api/arenas/"+id, "", bobToken)
	if code != http.StatusOK || opponentView["winner"] != result["winner"] {
		t.Fatalf("opponent did not see the result: %d %v", code, opponentView)
	}
	if code, _ := h.call("POST", "/api/arenas/"+id+"/forfeit", "", bobToken); code != http.StatusConflict {
		t.Fatalf("completed match forfeited twice: %d", code)
	}
	for range 3 {
		h.call("GET", "/api/arenas/"+id, "", aliceToken)
	}
	_, aliceRank := h.call("GET", "/api/ranks?player=Alice", "", "")
	_, bobRank := h.call("GET", "/api/ranks?player=Bob", "", "")
	if aliceRank["losses"] != float64(1) || bobRank["wins"] != float64(1) {
		t.Fatalf("server results must be recorded exactly once: %v %v", aliceRank, bobRank)
	}
}

func TestArenaQueueIgnoresClientRatings(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	join := func(name, rating string) map[string]any {
		t.Helper()
		code, result := h.call("POST", "/api/arena-queue", `{"name":"`+name+`","cardId":"pikachu","rating":`+rating+`}`, "")
		if code != http.StatusCreated {
			t.Fatalf("queue: %d %v", code, result)
		}
		return result
	}
	first := join("Alice", "10")
	// A second request using the same public name must not create a self-match.
	if result := join("Alice", "5000"); result["status"] != "waiting" {
		t.Fatalf("a public player matched themselves: %v", result)
	}
	if result := join("Bob", "5000"); result["opponent"] != "Alice" {
		t.Fatalf("server-derived equal ratings should pair oldest compatible request: %v", result)
	}
	_, status := h.call("GET", "/api/arena-queue/"+first["id"].(string), "", first["token"].(string))
	if status["status"] != "matched" {
		t.Fatalf("client rating spoof displaced the oldest equally ranked player: %v", status)
	}
}
