package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQueuePairsRealPlayersAndCanCancel(t *testing.T) {
	s := httptest.NewServer(New("http://localhost:3000"))
	defer s.Close()
	enqueue := func(name, card string, rating, entryCents int) arenaQueueResponse {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"name": name, "cardId": card, "rating": rating, "entryCents": entryCents})
		res, err := http.Post(s.URL+"/api/arena-queue", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("enqueue: %s", res.Status)
		}
		var entry arenaQueueResponse
		if err := json.NewDecoder(res.Body).Decode(&entry); err != nil {
			t.Fatal(err)
		}
		return entry
	}
	status := func(entry arenaQueueResponse) arenaQueueResponse {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, s.URL+"/api/arena-queue/"+entry.ID, nil)
		req.Header.Set("Authorization", "Bearer "+entry.Token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("status: %s", res.Status)
		}
		var result arenaQueueResponse
		if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	a := enqueue("Alice", "pikachu", 1500, 100)
	if a.Status != "waiting" || a.Arena != nil {
		t.Fatal("first player was not queued")
	}
	b := enqueue("Bob", "charmander", 1600, 100)
	after := status(a)
	if b.Status != "matched" || after.Status != "matched" || b.Arena == nil || after.Arena == nil || b.Arena.ID != after.Arena.ID || b.Arena.Token == after.Arena.Token {
		t.Fatal("players did not get distinct seats in one live match")
	}
	if after.Opponent != "Bob" || b.Opponent != "Alice" {
		t.Fatal("opponent names incorrect")
	}
	c := enqueue("Cara", "pikachu", 900, 0)
	req, _ := http.NewRequest(http.MethodDelete, s.URL+"/api/arena-queue/"+c.ID, nil)
	req.Header.Set("Authorization", "Bearer "+c.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("cancel: %s", res.Status)
	}
	d := enqueue("Dan", "charmander", 900, 0)
	if d.Status != "waiting" {
		t.Fatal("cancelled player was matched")
	}
	e := enqueue("Eve", "pikachu", 900, 100)
	if e.Status != "waiting" {
		t.Fatal("different demo entries were paired")
	}
	f := enqueue("Fran", "pikachu", 900, 0)
	if f.Status != "matched" || f.Arena == nil || status(d).Arena == nil || status(d).Arena.ID != f.Arena.ID {
		t.Fatal("matching demo entries did not pair")
	}
}
