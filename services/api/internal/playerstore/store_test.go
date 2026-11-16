package playerstore

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestPersistenceAndIdempotency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "players.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	fresh := s.Rank("Alice")
	if fresh.Rating != 1200 || fresh.Wins != 0 || fresh.Losses != 0 || len(fresh.History) != 0 {
		t.Fatalf("fresh: %+v", fresh)
	}
	if len(s.Leaderboard()) != 0 {
		t.Fatal("rank reads must not invent leaderboard players")
	}
	if err = s.Record("arena:one", " Alice ", "Bob", "player1"); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Record("arena:one", "alice", "Bob", "p1"); err != nil {
		t.Fatal(err)
	}
	a, b := s.Rank("ALICE"), s.Rank("Bob")
	if a.Rating != 1216 || a.Wins != 1 || b.Rating != 1184 || b.Losses != 1 || len(a.History) != 1 {
		t.Fatalf("bad persisted result: %+v %+v", a, b)
	}
	if err = s.Record("arena:one", "Alice", "Bob", "p2"); err == nil {
		t.Fatal("conflicting outcome accepted")
	}
	if err = s.Record("team:one:1", "Alice", "Bob", "draw"); err != nil {
		t.Fatal(err)
	}
	if s.Rank("Bob").Draws != 1 {
		t.Fatal("draw missing")
	}
	leaders := s.Leaderboard()
	if len(leaders) != 2 || leaders[0].Name != "Alice" {
		t.Fatalf("leaders: %+v", leaders)
	}
	// Callers cannot mutate history through a returned snapshot.
	a.History[0].Opponent = "changed"
	if s.Rank("Alice").History[0].Opponent != "Bob" {
		t.Fatal("mutable history leaked")
	}
}

func TestConcurrentDuplicateResults(t *testing.T) {
	s, _ := Open("")
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.Record("team:one:1", "Alice", "Bob", "p1"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if s.Rank("Alice").Wins != 1 || s.Rank("Bob").Losses != 1 {
		t.Fatal("duplicate result counted")
	}
}

func TestSaveFailureDoesNotPublishOrConsumeResult(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocked")
	if err := os.WriteFile(blocker, []byte("file, not directory"), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(filepath.Join(blocker, "players.json"))
	// Opening through a non-directory correctly fails; use an initially valid path
	// then block its parent to exercise a save failure after successful startup.
	if err == nil {
		t.Fatal("non-directory parent accepted")
	}
	parent := filepath.Join(dir, "store")
	s, err = Open(filepath.Join(parent, "players.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(parent, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = s.Record("arena:retry", "Alice", "Bob", "p1"); err == nil {
		t.Fatal("save failure swallowed")
	}
	if s.Rank("Alice").Rating != 1200 || len(s.Leaderboard()) != 0 {
		t.Fatal("failed save published result")
	}
	if err = os.Remove(parent); err != nil {
		t.Fatal(err)
	}
	if err = s.Record("arena:retry", "Alice", "Bob", "p1"); err != nil {
		t.Fatal(err)
	}
	if s.Rank("Alice").Wins != 1 {
		t.Fatal("failed save consumed result ID")
	}
}

func TestInvalidStoreAndResults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "players.json")
	for _, contents := range []string{"{", "null", "{}"} {
		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(path); err == nil {
			t.Fatalf("invalid store %q accepted", contents)
		}
	}
	s, _ := Open("")
	for _, winner := range []string{"", "Alice", "win"} {
		if s.Record("id", "Alice", "Bob", winner) == nil {
			t.Fatal("invalid winner accepted")
		}
	}
	if s.Record("id", "Alice", " ALICE ", "p1") == nil {
		t.Fatal("self result accepted")
	}
	if s.Record("id", "bad\nname", "Bob", "p1") == nil {
		t.Fatal("control characters accepted")
	}
}
