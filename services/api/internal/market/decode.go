package market

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"strings"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

// Layouts mirror contracts/programs/pokefun_market/src/lib.rs (Anchor + Borsh).

func discriminator(namespace, name string) []byte {
	sum := sha256.Sum256([]byte(namespace + ":" + name))
	return sum[:8]
}

var (
	discConfig     = discriminator("account", "MarketConfig")
	discCollection = discriminator("account", "ApprovedCollection")
	discListing    = discriminator("account", "Listing")
	discOffer      = discriminator("account", "Offer")
	discTrade      = discriminator("account", "Trade")
)

var errShort = errors.New("account data too short")

type reader struct {
	data []byte
	at   int
	err  error
}

func (r *reader) take(n int) []byte {
	if r.err != nil || r.at+n > len(r.data) {
		r.err = errShort
		return make([]byte, n)
	}
	out := r.data[r.at : r.at+n]
	r.at += n
	return out
}
func (r *reader) key() string   { return collectibles.Encode58(r.take(32)) }
func (r *reader) u8() uint8     { return r.take(1)[0] }
func (r *reader) boolean() bool { return r.u8() != 0 }
func (r *reader) u16() uint16   { return binary.LittleEndian.Uint16(r.take(2)) }
func (r *reader) u32() uint32   { return binary.LittleEndian.Uint32(r.take(4)) }
func (r *reader) u64() uint64   { return binary.LittleEndian.Uint64(r.take(8)) }
func (r *reader) i64() int64    { return int64(r.u64()) }
func (r *reader) keys() []string {
	n := int(r.u32())
	if n > 16 {
		r.err = errors.New("vector too long")
		return nil
	}
	out := make([]string, n)
	for i := range out {
		out[i] = r.key()
	}
	return out
}

type configAccount struct {
	Admin    string `json:"admin"`
	Treasury string `json:"treasury"`
	FeeBps   uint16 `json:"feeBps"`
	Paused   bool   `json:"paused"`
}

type collectionAccount struct {
	Collection string
	Enabled    bool
}

type listingAccount struct {
	Address    string
	Seller     string
	Asset      string
	Collection string
	Price      uint64
	CreatedAt  int64
}

type offerAccount struct {
	Address   string
	Buyer     string
	Asset     string
	Amount    uint64
	Counter   uint64
	CreatedAt int64
	ExpiresAt int64
}

type tradeAccount struct {
	Address      string
	Proposer     string
	Counterparty string
	Collection   string
	Nonce        uint64
	Give         []string
	Want         []string
	AddLamports  uint64
	CreatedAt    int64
	ExpiresAt    int64
}

// programState is every live account the market program owns.
type programState struct {
	Config      *configAccount
	Collections []collectionAccount
	Listings    []listingAccount
	Offers      []offerAccount
	Trades      []tradeAccount
}

func decodeProgramAccounts(accounts []programAccount) programState {
	var state programState
	for _, account := range accounts {
		if len(account.Data) < 8 {
			continue
		}
		disc, r := account.Data[:8], &reader{data: account.Data, at: 8}
		switch {
		case bytes.Equal(disc, discConfig):
			c := configAccount{Admin: r.key(), Treasury: r.key(), FeeBps: r.u16(), Paused: r.boolean()}
			if r.err == nil {
				state.Config = &c
			}
		case bytes.Equal(disc, discCollection):
			c := collectionAccount{Collection: r.key(), Enabled: r.boolean()}
			if r.err == nil {
				state.Collections = append(state.Collections, c)
			}
		case bytes.Equal(disc, discListing):
			l := listingAccount{Address: account.Pubkey, Seller: r.key(), Asset: r.key(), Collection: r.key(), Price: r.u64(), CreatedAt: r.i64()}
			if r.err == nil {
				state.Listings = append(state.Listings, l)
			}
		case bytes.Equal(disc, discOffer):
			o := offerAccount{Address: account.Pubkey, Buyer: r.key(), Asset: r.key(), Amount: r.u64(), Counter: r.u64(), CreatedAt: r.i64(), ExpiresAt: r.i64()}
			if r.err == nil {
				state.Offers = append(state.Offers, o)
			}
		case bytes.Equal(disc, discTrade):
			t := tradeAccount{Address: account.Pubkey, Proposer: r.key(), Counterparty: r.key(), Collection: r.key(), Nonce: r.u64(), Give: r.keys(), Want: r.keys(), AddLamports: r.u64(), CreatedAt: r.i64(), ExpiresAt: r.i64()}
			if r.err == nil {
				state.Trades = append(state.Trades, t)
			}
		}
	}
	return state
}

// Event is one decoded program event, persisted for history.
type Event struct {
	Name         string   `json:"name"`
	Signature    string   `json:"signature"`
	Slot         uint64   `json:"slot"`
	At           int64    `json:"at"` // unix ms
	Asset        string   `json:"asset,omitempty"`
	Seller       string   `json:"seller,omitempty"`
	Buyer        string   `json:"buyer,omitempty"`
	Price        uint64   `json:"price,omitempty"`
	Fee          uint64   `json:"fee,omitempty"`
	Kind         string   `json:"kind,omitempty"`
	Reason       string   `json:"reason,omitempty"`
	Trade        string   `json:"trade,omitempty"`
	Proposer     string   `json:"proposer,omitempty"`
	Counterparty string   `json:"counterparty,omitempty"`
	Give         []string `json:"give,omitempty"`
	Want         []string `json:"want,omitempty"`
}

var closeReasons = []string{"cancelled", "declined", "expired", "accepted"}
var saleKinds = []string{"buy", "offer", "counter"}

func enumName(names []string, value uint8) string {
	if int(value) < len(names) {
		return names[value]
	}
	return "unknown"
}

var eventDecoders = map[string]func(*reader) Event{
	"Listed":       func(r *reader) Event { return Event{Asset: r.key(), Seller: r.key(), Price: r.u64()} },
	"PriceUpdated": func(r *reader) Event { return Event{Asset: r.key(), Seller: r.key(), Price: r.u64()} },
	"ListingClosed": func(r *reader) Event {
		return Event{Asset: r.key(), Seller: r.key(), Reason: enumName(closeReasons, r.u8())}
	},
	"Sale": func(r *reader) Event {
		return Event{Asset: r.key(), Seller: r.key(), Buyer: r.key(), Price: r.u64(), Fee: r.u64(), Kind: enumName(saleKinds, r.u8())}
	},
	"OfferMade":      func(r *reader) Event { return Event{Asset: r.key(), Buyer: r.key(), Price: r.u64()} },
	"OfferCountered": func(r *reader) Event { return Event{Asset: r.key(), Buyer: r.key(), Price: r.u64()} },
	"OfferClosed": func(r *reader) Event {
		return Event{Asset: r.key(), Buyer: r.key(), Reason: enumName(closeReasons, r.u8())}
	},
	"TradeProposed": func(r *reader) Event {
		return Event{Trade: r.key(), Proposer: r.key(), Counterparty: r.key(), Give: r.keys(), Want: r.keys(), Price: r.u64()}
	},
	"TradeClosed": func(r *reader) Event {
		return Event{Trade: r.key(), Proposer: r.key(), Counterparty: r.key(), Reason: enumName(closeReasons, r.u8())}
	},
}

var eventDiscs = func() map[string]string {
	out := map[string]string{}
	for name := range eventDecoders {
		out[string(discriminator("event", name))] = name
	}
	return out
}()

// decodeEvents reads `Program data:` log lines emitted directly by programID.
func decodeEvents(programID string, logs []string) []Event {
	var out []Event
	var stack []string
	for _, line := range logs {
		switch {
		case strings.HasPrefix(line, "Program ") && strings.Contains(line, " invoke ["):
			stack = append(stack, strings.Fields(line)[1])
		case strings.HasPrefix(line, "Program ") && (strings.HasSuffix(line, " success") || strings.Contains(line, " failed")):
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case strings.HasPrefix(line, "Program data: "):
			if len(stack) == 0 || stack[len(stack)-1] != programID {
				continue
			}
			raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(line, "Program data: "))
			if err != nil || len(raw) < 8 {
				continue
			}
			name, ok := eventDiscs[string(raw[:8])]
			if !ok {
				continue
			}
			r := &reader{data: raw, at: 8}
			event := eventDecoders[name](r)
			if r.err != nil {
				continue
			}
			event.Name = name
			out = append(out, event)
		}
	}
	return out
}
