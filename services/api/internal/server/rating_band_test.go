package server

import (
	"testing"
	"time"
)

func TestRatingBandWidensWithWaitingTime(t *testing.T) {
	for _, tt := range []struct {
		waited time.Duration
		band   int
	}{{0, 100}, {4 * time.Second, 100}, {5 * time.Second, 150}, {30 * time.Second, 400}, {time.Minute, 700}} {
		if got := ratingBand(tt.waited); got != tt.band {
			t.Fatalf("ratingBand(%v) = %d, want %d", tt.waited, got, tt.band)
		}
	}
	if !withinRatingBand(1200, 1500, 0, time.Minute) || withinRatingBand(1200, 1500, 0, 0) {
		t.Fatal("the longer-waiting player's band must apply")
	}
}

// bandHarness gives Ash a rating far above a newcomer's 1200.
func bandHarness(t *testing.T) (harness, *Server) {
	t.Helper()
	h, err := NewWithConfig(Config{Origin: "http://localhost:3000"})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 25 {
		if err := h.server.recordPlayerResult("seed:"+itoa(i), "Ash", "Zed"+itoa(i), "p1"); err != nil {
			t.Fatal(err)
		}
	}
	if gap := h.server.playerRating("Ash") - 1200; gap <= ratingBandBase {
		t.Fatalf("seeded gap %d is inside the initial band", gap)
	}
	return harness{t, h}, h.server
}

func TestArenaQueuePairsAcrossRatingsOnlyAfterBandWidens(t *testing.T) {
	h, s := bandHarness(t)
	code, ash := h.call("POST", "/api/arena-queue", `{"name":"Ash","cardId":"pikachu"}`, "")
	if code != 201 || ash["status"] != "waiting" {
		t.Fatalf("ash: %d %v", code, ash)
	}
	_, misty := h.call("POST", "/api/arena-queue", `{"name":"Misty","cardId":"pikachu"}`, "")
	if misty["status"] != "waiting" {
		t.Fatalf("a distant rating paired immediately: %v", misty)
	}
	s.mu.Lock()
	s.arenaQueue[ash["id"].(string)].created = time.Now().Add(-2 * time.Minute)
	s.mu.Unlock()
	_, polled := h.call("GET", "/api/arena-queue/"+misty["id"].(string), "", misty["token"].(string))
	if polled["status"] != "matched" || polled["opponent"] != "Ash" {
		t.Fatalf("widened band did not pair on poll: %v", polled)
	}
	_, ashPoll := h.call("GET", "/api/arena-queue/"+ash["id"].(string), "", ash["token"].(string))
	if ashPoll["arena"].(map[string]any)["id"] != polled["arena"].(map[string]any)["id"] {
		t.Fatalf("players were not paired into the same arena: %v %v", ashPoll, polled)
	}
}

func TestTeamQueuePairsAcrossRatingsOnlyAfterBandWidens(t *testing.T) {
	h, s := bandHarness(t)
	join := func(name string) map[string]any {
		_, out := h.call("POST", "/api/queue", `{"trainer":{"name":"`+name+`"},"format":"champion","tier":1,"entry":0,"team":[{"species":"pikachu"}]}`, "")
		return out
	}
	ash := join("Ash")
	misty := join("Misty")
	if misty["status"] != "searching" {
		t.Fatalf("a distant rating paired immediately: %v", misty)
	}
	s.mu.Lock()
	s.queue[ash["ticket"].(string)].created = time.Now().Add(-time.Minute)
	s.mu.Unlock()
	_, polled := h.call("GET", "/api/queue/"+misty["ticket"].(string), "", "")
	if polled["status"] != "matched" || polled["side"] != "p2" {
		t.Fatalf("widened band did not pair on poll: %v", polled)
	}
	_, ashPoll := h.call("GET", "/api/queue/"+ash["ticket"].(string), "", "")
	if ashPoll["status"] != "matched" || ashPoll["id"] != polled["id"] || ashPoll["side"] != "p1" {
		t.Fatalf("players were not paired into the same battle: %v %v", ashPoll, polled)
	}
	_, again := h.call("GET", "/api/queue/"+misty["ticket"].(string), "", "")
	if again["id"] != polled["id"] {
		t.Fatalf("matched ticket is not retryable: %v", again)
	}
}
