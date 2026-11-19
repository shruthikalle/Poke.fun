package market

import (
	"sort"
	"strconv"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

// Snapshot is the whole marketplace as the web app reads it. Amounts are lamports;
// times are unix milliseconds.
type Snapshot struct {
	Ready       bool           `json:"ready"`
	UpdatedAt   int64          `json:"updatedAt"`
	Warning     string         `json:"warning,omitempty"`
	ProgramID   string         `json:"programId"`
	Config      *configAccount `json:"config"`
	Collections []string       `json:"collections"`
	Cards       []Card         `json:"cards"`
	Listings    []Listing      `json:"listings"`
	Offers      []Offer        `json:"offers"`
	Trades      []Trade        `json:"trades"`
	Sales       []Sale         `json:"sales"`
	Onboarding  Onboarding     `json:"onboarding"`
}

// Onboarding says which devnet helpers the server offers.
type Onboarding struct {
	Mint           bool   `json:"mint"`
	Faucet         bool   `json:"faucet"`
	FaucetLamports uint64 `json:"faucetLamports,omitempty"`
	Collection     string `json:"collection,omitempty"`
	MintsPerDay    int    `json:"mintsPerDay,omitempty"`
}

type Card struct {
	Mint       string                   `json:"mint"`
	Owner      string                   `json:"owner"`
	Collection string                   `json:"collection"`
	Name       string                   `json:"name"`
	URI        string                   `json:"uri"`
	Image      string                   `json:"image,omitempty"`
	Attributes []collectibles.Attribute `json:"attributes"`
}

type Listing struct {
	ID        string `json:"id"`
	Mint      string `json:"mint"`
	Seller    string `json:"seller"`
	Price     uint64 `json:"price"`
	Status    string `json:"status"` // active | sold | cancelled
	ListedAt  int64  `json:"listedAt"`
	SoldPrice uint64 `json:"soldPrice,omitempty"`
	Buyer     string `json:"buyer,omitempty"`
	SoldAt    int64  `json:"soldAt,omitempty"`
}

type Offer struct {
	ID        string `json:"id"`
	ListingID string `json:"listingId"`
	Mint      string `json:"mint"`
	Buyer     string `json:"buyer"`
	Amount    uint64 `json:"amount"`
	Counter   uint64 `json:"counter,omitempty"`
	Status    string `json:"status"` // pending | countered | accepted | declined | cancelled | expired
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
}

type Trade struct {
	ID           string   `json:"id"` // trade account address
	Proposer     string   `json:"proposer"`
	Counterparty string   `json:"counterparty"`
	Give         []string `json:"give"`
	Want         []string `json:"want"`
	AddLamports  uint64   `json:"addLamports"`
	Status       string   `json:"status"` // pending | accepted | declined | cancelled | expired
	CreatedAt    int64    `json:"createdAt"`
	ExpiresAt    int64    `json:"expiresAt,omitempty"`
}

type Sale struct {
	Mint      string `json:"mint"`
	Seller    string `json:"seller"`
	Buyer     string `json:"buyer"`
	Price     uint64 `json:"price"`
	Fee       uint64 `json:"fee"`
	Kind      string `json:"kind"`
	At        int64  `json:"at"`
	Signature string `json:"signature"`
}

// build merges live accounts (authoritative for anything open) with event
// history (for sold, cancelled and answered items).
func build(programID string, state programState, cards map[string]Card, events []Event) Snapshot {
	snap := Snapshot{ProgramID: programID, Config: state.Config, Collections: []string{}, Cards: []Card{},
		Listings: []Listing{}, Offers: []Offer{}, Trades: []Trade{}, Sales: []Sale{}}
	for _, c := range state.Collections {
		if c.Enabled {
			snap.Collections = append(snap.Collections, c.Collection)
		}
	}
	for _, card := range cards {
		snap.Cards = append(snap.Cards, card)
	}
	sort.Slice(snap.Cards, func(i, j int) bool { return snap.Cards[i].Mint < snap.Cards[j].Mint })

	var listings []*Listing
	openListing := map[string]*Listing{}
	var offers []*Offer
	openOffer := map[string]*Offer{}
	var trades []*Trade
	tradeByID := map[string]*Trade{}

	for _, ev := range events {
		switch ev.Name {
		case "Listed":
			l := &Listing{ID: "l:" + ev.Signature, Mint: ev.Asset, Seller: ev.Seller, Price: ev.Price, Status: "active", ListedAt: ev.At}
			listings = append(listings, l)
			openListing[ev.Asset] = l
		case "PriceUpdated":
			if l := openListing[ev.Asset]; l != nil {
				l.Price = ev.Price
			}
		case "Sale":
			if l := openListing[ev.Asset]; l != nil {
				l.Status, l.SoldPrice, l.Buyer, l.SoldAt = "sold", ev.Price, ev.Buyer, ev.At
				delete(openListing, ev.Asset)
			}
			if ev.Kind != "buy" {
				if o := openOffer[ev.Asset+ev.Buyer]; o != nil {
					o.Status = "accepted"
					delete(openOffer, ev.Asset+ev.Buyer)
				}
			}
			snap.Sales = append(snap.Sales, Sale{Mint: ev.Asset, Seller: ev.Seller, Buyer: ev.Buyer, Price: ev.Price, Fee: ev.Fee, Kind: ev.Kind, At: ev.At, Signature: ev.Signature})
		case "ListingClosed":
			if l := openListing[ev.Asset]; l != nil {
				l.Status = "cancelled"
				delete(openListing, ev.Asset)
			}
		case "OfferMade":
			o := &Offer{ID: "o:" + ev.Signature, Mint: ev.Asset, Buyer: ev.Buyer, Amount: ev.Price, Status: "pending", CreatedAt: ev.At}
			if l := openListing[ev.Asset]; l != nil {
				o.ListingID = l.ID
			}
			offers = append(offers, o)
			openOffer[ev.Asset+ev.Buyer] = o
		case "OfferCountered":
			if o := openOffer[ev.Asset+ev.Buyer]; o != nil {
				o.Counter, o.Status = ev.Price, "countered"
			}
		case "OfferClosed":
			if o := openOffer[ev.Asset+ev.Buyer]; o != nil {
				o.Status = ev.Reason
				delete(openOffer, ev.Asset+ev.Buyer)
			}
		case "TradeProposed":
			t := &Trade{ID: ev.Trade, Proposer: ev.Proposer, Counterparty: ev.Counterparty, Give: nonNil(ev.Give), Want: nonNil(ev.Want), AddLamports: ev.Price, Status: "pending", CreatedAt: ev.At}
			trades = append(trades, t)
			tradeByID[ev.Trade] = t
		case "TradeClosed":
			if t := tradeByID[ev.Trade]; t != nil && t.Status == "pending" {
				t.Status = ev.Reason
			}
		}
	}

	// Live accounts win: they define what is open now.
	liveListing := map[string]bool{}
	for _, a := range state.Listings {
		l := openListing[a.Asset]
		if l == nil || l.Seller != a.Seller {
			l = &Listing{ID: "l:" + a.Address, Mint: a.Asset, Seller: a.Seller, ListedAt: a.CreatedAt * 1000}
			listings = append(listings, l)
			openListing[a.Asset] = l
		}
		l.Price, l.Status = a.Price, "active"
		liveListing[a.Asset] = true
	}
	for asset, l := range openListing {
		if !liveListing[asset] {
			l.Status = "cancelled" // closed while we missed the event
		}
	}
	liveOffer := map[string]bool{}
	for _, a := range state.Offers {
		key := a.Asset + a.Buyer
		o := openOffer[key]
		if o == nil {
			o = &Offer{ID: "o:" + a.Address + ":" + strconv.FormatInt(a.CreatedAt, 10), Mint: a.Asset, Buyer: a.Buyer, CreatedAt: a.CreatedAt * 1000}
			offers = append(offers, o)
			openOffer[key] = o
		}
		if l := openListing[a.Asset]; l != nil && l.Status == "active" && o.ListingID == "" {
			o.ListingID = l.ID
		}
		o.Amount, o.Counter, o.ExpiresAt = a.Amount, a.Counter, a.ExpiresAt*1000
		o.Status = "pending"
		if a.Counter > 0 {
			o.Status = "countered"
		}
		liveOffer[key] = true
	}
	for key, o := range openOffer {
		if !liveOffer[key] {
			o.Status = "expired"
		}
	}
	liveTrade := map[string]bool{}
	for _, a := range state.Trades {
		t := tradeByID[a.Address]
		if t == nil || t.Status != "pending" {
			t = &Trade{ID: a.Address, Proposer: a.Proposer, Counterparty: a.Counterparty, Give: nonNil(a.Give), Want: nonNil(a.Want), AddLamports: a.AddLamports, CreatedAt: a.CreatedAt * 1000}
			trades = append(trades, t)
			tradeByID[a.Address] = t
		}
		t.Status, t.ExpiresAt = "pending", a.ExpiresAt*1000
		liveTrade[a.Address] = true
	}
	for id, t := range tradeByID {
		if t.Status == "pending" && !liveTrade[id] {
			t.Status = "cancelled"
		}
	}

	for i := len(listings) - 1; i >= 0; i-- { // newest first, like the mock
		snap.Listings = append(snap.Listings, *listings[i])
	}
	for i := len(offers) - 1; i >= 0; i-- {
		snap.Offers = append(snap.Offers, *offers[i])
	}
	for i := len(trades) - 1; i >= 0; i-- {
		snap.Trades = append(snap.Trades, *trades[i])
	}
	return snap
}

func nonNil(keys []string) []string {
	if keys == nil {
		return []string{}
	}
	return keys
}
