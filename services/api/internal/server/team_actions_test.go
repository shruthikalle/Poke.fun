package server

import (
	"net/http"
	"testing"
)

func TestTeamForfeitAwardsOpponentAndSealsResult(t *testing.T) {
	h := harness{t, New("http://localhost:3000")}
	join := func(name string) map[string]any {
		t.Helper()
		_, out := h.call("POST", "/api/queue", `{"trainer":{"name":"`+name+`"},"format":"champion","tier":1,"entry":0,"team":[{"species":"pikachu"}]}`, "")
		return out
	}
	ash := join("Ash")
	misty := join("Misty")
	_, ashMatch := h.call("GET", "/api/queue/"+ash["ticket"].(string), "", "")
	id, p1, p2 := misty["id"].(string), ashMatch["token"].(string), misty["token"].(string)

	if code, _ := h.call("POST", "/api/battles/"+id+"/forfeit", "", "invalid"); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated forfeit: %d", code)
	}
	if code, out := h.call("POST", "/api/battles/"+id+"/forfeit", "", p1); code != http.StatusOK {
		t.Fatalf("forfeit: %d %v", code, out)
	}
	if code, _ := h.call("POST", "/api/battles/"+id+"/forfeit", "", p2); code != http.StatusConflict {
		t.Fatalf("finished battle forfeited twice: %d", code)
	}
	code, envelope := h.call("GET", "/api/battles/"+id+"/result", "", p2)
	result, _ := envelope["result"].(map[string]any)
	if code != http.StatusOK || result["winner"] != "p2" || result["reason"] != "forfeit" {
		t.Fatalf("sealed result: %d %v", code, envelope)
	}
	_, ashRank := h.call("GET", "/api/ranks?player=Ash", "", "")
	_, mistyRank := h.call("GET", "/api/ranks?player=Misty", "", "")
	if ashRank["losses"] != float64(1) || mistyRank["wins"] != float64(1) {
		t.Fatalf("forfeit not ranked exactly once: %v %v", ashRank, mistyRank)
	}
}
