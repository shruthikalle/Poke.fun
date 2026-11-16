package resultstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func completed() Result {
	return Result{ID: "arena:one", MatchID: "one", Mode: "arena", Round: 1,
		Players: [2]Participant{{Seat: "p1", Name: "Alice", Species: []string{"pikachu"}},
			{Seat: "p2", Name: "Bob", Species: []string{"charmander"}}},
		Winner: "p1", Reason: "knockout", RulesVersion: "arena-v1", CatalogVersion: "dex-v1",
		StateHash: strings.Repeat("a", 64)}
}

func TestReplayIsBoundToSignedResultAndHistory(t *testing.T) {
	dir := t.TempDir()
	path, key := filepath.Join(dir, "results.json"), filepath.Join(dir, "referee.key")
	store, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	replay := json.RawMessage(`[{"hp":42,"tick":1}]`)
	digest := sha256.Sum256(replay)
	result := completed()
	result.StateHash = hex.EncodeToString(digest[:])
	sealed, err := store.SealReplay(result, replay)
	if err != nil || !Verify(sealed) {
		t.Fatalf("seal replay: %v", err)
	}
	if len(store.List("alice")) != 1 || len(store.List("nobody")) != 0 {
		t.Fatal("history lookup failed")
	}
	if _, err := store.SealReplay(result, json.RawMessage(`[{"tick":1,"hp":41}]`)); err == nil {
		t.Fatal("changed replay accepted")
	}
	restarted, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	loaded, ok := restarted.Get(result.ID)
	if !ok || string(loaded.Replay) != string(replay) {
		t.Fatal("replay did not survive restart")
	}
	loaded.Replay[0] = 'x'
	again, _ := restarted.Get(result.ID)
	if again.Replay[0] == 'x' {
		t.Fatal("caller mutated stored replay")
	}
}

func TestSealedResultsSurviveRestartAndRejectTampering(t *testing.T) {
	dir := t.TempDir()
	path, key := filepath.Join(dir, "results.json"), filepath.Join(dir, "referee.key")
	store, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	input := completed()
	sealed, err := store.Seal(input)
	if err != nil || !Verify(sealed) {
		t.Fatalf("seal: %v", err)
	}
	input.Players[0].Species[0] = "mewtwo"
	copy := sealed
	copy.Result.Winner = "p2"
	if Verify(copy) {
		t.Fatal("tampered winner verified")
	}
	restarted, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := restarted.Seal(completed())
	if err != nil || !reflect.DeepEqual(sealed, repeated) {
		t.Fatalf("restart changed sealed bytes: %v", err)
	}
	changed := completed()
	changed.Winner = "draw"
	if _, err := restarted.Seal(changed); err == nil {
		t.Fatal("a sealed winner was overwritten")
	}
	repeated.Result.Players[0].Species[0] = "mewtwo"
	stored, _ := restarted.Get(sealed.Result.ID)
	if stored.Result.Players[0].Species[0] != "pikachu" {
		t.Fatal("caller mutated stored result")
	}
	if stored.Result.Funding != "unfunded" || stored.Result.Settlement != "not_connected" {
		t.Fatal("game result claimed financial settlement")
	}
	if info, err := os.Stat(key); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("signing key permissions: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"arena:one":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, key); err == nil {
		t.Fatal("corrupt signed result store silently accepted")
	}
}

func TestConcurrentSealHasOneImmutableResult(t *testing.T) {
	store, err := Open("", "")
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for range 16 {
		group.Add(1)
		go func() {
			defer group.Done()
			sealed, err := store.Seal(completed())
			if err != nil || !Verify(sealed) {
				t.Errorf("seal: %v", err)
			}
		}()
	}
	group.Wait()
	if len(store.records) != 1 {
		t.Fatal("concurrent seal duplicated results")
	}
}
