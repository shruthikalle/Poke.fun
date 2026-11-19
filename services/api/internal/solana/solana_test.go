package solana

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompileSignsRequiredAccounts(t *testing.T) {
	payer, asset := NewKeypair(), NewKeypair()
	ix := CreateCoreAsset(asset.Public, NewKeypair().Public, payer.Public, payer.Public, NewKeypair().Public, "Test", "https://gateway.irys.xyz/test")
	wire, err := Compile(NewKeypair().Public, []Instruction{ix}, payer, asset)
	if err != nil {
		t.Fatal(err)
	}
	if wire[0] != 2 {
		t.Fatalf("expected two signatures, got %d", wire[0])
	}
	message := wire[129:]
	if !ed25519.Verify(payer.Public[:], message, wire[1:65]) || !ed25519.Verify(asset.Public[:], message, wire[65:129]) {
		t.Fatal("invalid transaction signatures")
	}
	if _, err := Compile(NewKeypair().Public, []Instruction{ix}, payer); err == nil {
		t.Fatal("missing asset signature accepted")
	}
}

func TestDevnetGuardRejectsMainnetEvenOnLoopback(t *testing.T) {
	for _, tc := range []struct {
		genesis string
		allowed bool
	}{
		{"EtWTRABZaYq6iMfeYKouRu166VU2xqa1", true},
		{"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", false},
		{"local-validator-genesis", true},
	} {
		t.Run(tc.genesis, func(t *testing.T) {
			rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": tc.genesis})
			}))
			defer rpc.Close()
			if err := NewClient(rpc.URL).CheckDevnet(context.Background()); (err == nil) != tc.allowed {
				t.Fatalf("guard returned %v, allowed=%v", err, tc.allowed)
			}
		})
	}
}
