package market

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestGrantLimitsPersistAndRelease(t *testing.T) {
	path := filepath.Join(t.TempDir(), "market.json")
	s, err := New(Options{ProgramID: key(50), StorePath: path})
	if err != nil {
		t.Fatal(err)
	}
	l := limit{perOwner: 1, perIP: 2, global: 3, window: time.Hour}
	if err := s.allowLocked("mint", "alice", "ip1", l); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Options{ProgramID: key(50), StorePath: path})
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.allowLocked("mint", "alice", "ip2", l); !errors.Is(err, errLimited) {
		t.Fatalf("owner quota lost on restart: %v", err)
	}
	if err := restored.allowLocked("mint", "bob", "ip1", l); err != nil {
		t.Fatal(err)
	}
	if err := restored.allowLocked("mint", "carol", "ip1", l); !errors.Is(err, errLimited) {
		t.Fatalf("IP quota bypass: %v", err)
	}
	if err := restored.allowLocked("mint", "carol", "ip2", l); err != nil {
		t.Fatal(err)
	}
	if err := restored.allowLocked("mint", "dave", "ip3", l); !errors.Is(err, errLimited) {
		t.Fatalf("global quota bypass: %v", err)
	}
	restored.releaseLocked("mint", "carol", "ip2")
	if err := restored.allowLocked("mint", "dave", "ip3", l); err != nil {
		t.Fatalf("failed grant did not release quota: %v", err)
	}
}

func TestGrantWindowExpires(t *testing.T) {
	s, _ := New(Options{ProgramID: key(50)})
	s.store.Grants = map[string][]int64{"mint:owner:alice": {time.Now().Add(-2 * time.Hour).UnixMilli()}}
	if err := s.allowLocked("mint", "alice", "ip", limit{perOwner: 1, perIP: 1, global: 1, window: time.Hour}); err != nil {
		t.Fatal(err)
	}
}
