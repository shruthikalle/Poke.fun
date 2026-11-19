package market

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"os"
	"testing"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

func key(b byte) string {
	k := make([]byte, 32)
	k[0], k[31] = b, b
	return collectibles.Encode58(k)
}

func keyBytes(k string) []byte { raw, _ := collectibles.Decode58(k); return raw }

func le64(n uint64) []byte { b := make([]byte, 8); binary.LittleEndian.PutUint64(b, n); return b }

func concat(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func TestDecodeAccounts(t *testing.T) {
	seller, asset, coll := key(1), key(2), key(3)
	listing := concat(discListing, keyBytes(seller), keyBytes(asset), keyBytes(coll), le64(1_500_000_000), le64(1700000000), []byte{254})
	trade := concat(discTrade, keyBytes(seller), keyBytes(key(4)), keyBytes(coll), le64(9),
		[]byte{1, 0, 0, 0}, keyBytes(asset), []byte{2, 0, 0, 0}, keyBytes(key(5)), keyBytes(key(6)), le64(10), le64(1), le64(2), []byte{1})
	config := concat(discConfig, keyBytes(key(7)), keyBytes(key(8)), []byte{250, 0, 0, 1, 1})
	state := decodeProgramAccounts([]programAccount{{Pubkey: key(9), Data: listing}, {Pubkey: key(10), Data: trade}, {Pubkey: key(11), Data: config}, {Pubkey: key(12), Data: []byte{1, 2}}})
	if len(state.Listings) != 1 || state.Listings[0].Price != 1_500_000_000 || state.Listings[0].Seller != seller || state.Listings[0].Asset != asset {
		t.Fatalf("listing: %+v", state.Listings)
	}
	if len(state.Trades) != 1 || len(state.Trades[0].Give) != 1 || len(state.Trades[0].Want) != 2 || state.Trades[0].AddLamports != 10 {
		t.Fatalf("trade: %+v", state.Trades)
	}
	if state.Config == nil || state.Config.FeeBps != 250 || state.Config.Treasury != key(8) {
		t.Fatalf("config: %+v", state.Config)
	}
}

func TestDecodeEventsOnlyFromProgram(t *testing.T) {
	program := key(20)
	data := base64.StdEncoding.EncodeToString(concat(discriminator("event", "Sale"), keyBytes(key(2)), keyBytes(key(1)), keyBytes(key(4)), le64(100), le64(2), []byte{1}))
	logs := []string{
		"Program " + program + " invoke [1]",
		"Program " + key(21) + " invoke [2]",
		"Program data: " + data, // emitted by a CPI callee: ignored
		"Program " + key(21) + " success",
		"Program data: " + data,
		"Program " + program + " success",
	}
	events := decodeEvents(program, logs)
	if len(events) != 1 || events[0].Name != "Sale" || events[0].Price != 100 || events[0].Kind != "offer" || events[0].Buyer != key(4) {
		t.Fatalf("events: %+v", events)
	}
}

func TestBuildMergesHistoryAndLiveAccounts(t *testing.T) {
	a1, a2, alice, bob := key(1), key(2), key(3), key(4)
	events := []Event{
		{Name: "Listed", Signature: "s1", At: 1, Asset: a1, Seller: alice, Price: 10},
		{Name: "OfferMade", Signature: "s2", At: 2, Asset: a1, Buyer: bob, Price: 8},
		{Name: "OfferCountered", Signature: "s3", At: 3, Asset: a1, Buyer: bob, Price: 9},
		{Name: "Sale", Signature: "s4", At: 4, Asset: a1, Seller: alice, Buyer: bob, Price: 9, Kind: "counter"},
		{Name: "Listed", Signature: "s5", At: 5, Asset: a2, Seller: alice, Price: 20},
		{Name: "PriceUpdated", Signature: "s6", At: 6, Asset: a2, Seller: alice, Price: 25},
		{Name: "TradeProposed", Signature: "s7", At: 7, Trade: "T1", Proposer: alice, Counterparty: bob, Give: []string{a2}, Want: []string{a1}},
		{Name: "TradeClosed", Signature: "s8", At: 8, Trade: "T1", Reason: "declined"},
	}
	state := programState{Listings: []listingAccount{{Address: "L2", Asset: a2, Seller: alice, Price: 25}}}
	snap := build("P", state, nil, events)
	if len(snap.Listings) != 2 || snap.Listings[0].Status != "active" || snap.Listings[0].ID != "l:s5" || snap.Listings[0].Price != 25 {
		t.Fatalf("active listing: %+v", snap.Listings)
	}
	if snap.Listings[1].Status != "sold" || snap.Listings[1].SoldPrice != 9 || snap.Listings[1].Buyer != bob {
		t.Fatalf("sold listing: %+v", snap.Listings[1])
	}
	if len(snap.Offers) != 1 || snap.Offers[0].Status != "accepted" || snap.Offers[0].Counter != 9 || snap.Offers[0].ListingID != "l:s1" {
		t.Fatalf("offer: %+v", snap.Offers)
	}
	if len(snap.Trades) != 1 || snap.Trades[0].Status != "declined" || len(snap.Sales) != 1 {
		t.Fatalf("trades/sales: %+v %+v", snap.Trades, snap.Sales)
	}
}

func TestBuildWithoutHistoryUsesAccounts(t *testing.T) {
	a1, alice, bob := key(1), key(3), key(4)
	state := programState{
		Listings: []listingAccount{{Address: "L1", Asset: a1, Seller: alice, Price: 5, CreatedAt: 100}},
		Offers:   []offerAccount{{Address: "O1", Asset: a1, Buyer: bob, Amount: 4, Counter: 6, CreatedAt: 101}},
		Trades:   []tradeAccount{{Address: "T1", Proposer: bob, Counterparty: alice, Want: []string{a1}, AddLamports: 3}},
	}
	snap := build("P", state, nil, nil)
	if snap.Listings[0].ListedAt != 100_000 || snap.Offers[0].Status != "countered" || snap.Offers[0].ListingID != "l:L1" || snap.Trades[0].Status != "pending" || snap.Trades[0].Give == nil {
		t.Fatalf("snapshot: %+v", snap)
	}
}

// Set MARKET_E2E_RPC (and MARKET_E2E_PROGRAM) after running contracts/tests/market.mjs
// against a local validator to index the real program end to end.
func TestSyncAgainstValidator(t *testing.T) {
	rpc := os.Getenv("MARKET_E2E_RPC")
	if rpc == "" {
		t.Skip("MARKET_E2E_RPC not set")
	}
	svc, err := New(Options{RPCURL: rpc, ProgramID: os.Getenv("MARKET_E2E_PROGRAM")})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := svc.Sync(ctx, true); err != nil {
		t.Fatal(err)
	}
	snap := svc.Snapshot()
	count := map[string]int{}
	for _, l := range snap.Listings {
		count["listing:"+l.Status]++
	}
	for _, o := range snap.Offers {
		count["offer:"+o.Status]++
	}
	for _, tr := range snap.Trades {
		count["trade:"+tr.Status]++
	}
	t.Logf("cards=%d sales=%d collections=%d counts=%v fee=%d", len(snap.Cards), len(snap.Sales), len(snap.Collections), count, snap.Config.FeeBps)
	if snap.Config == nil || snap.Config.FeeBps != 250 || len(snap.Collections) != 1 || len(snap.Cards) != 9 || len(snap.Sales) != 3 {
		t.Fatalf("unexpected snapshot")
	}
	if count["listing:sold"] != 3 || count["offer:accepted"] != 2 || count["trade:accepted"] != 1 || count["trade:declined"] != 1 || count["trade:cancelled"] != 1 {
		t.Fatalf("unexpected history: %v", count)
	}
}
