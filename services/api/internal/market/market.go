// Package market indexes the pokefun_market Solana program into a read-only
// snapshot for the web app. The chain is the source of truth: live listings,
// offers and trades come from program accounts on every sync, card ownership
// from Metaplex Core accounts, and history from program events. The service
// uses a separate optional devnet minter for onboarding; users sign every trade.
package market

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

type Options struct {
	RPCURL        string
	ProgramID     string
	StorePath     string        // "" keeps history in memory
	Poll          time.Duration // default 5s
	Discovery     time.Duration // full card rescan interval, default 60s
	MetadataHosts map[string]bool
	HTTP          *http.Client
	PriceURL      string  // SOL/USD source; "" disables
	Minter        *Minter // devnet card minting and SOL faucet; nil disables
}

type Service struct {
	opts    Options
	rpc     *rpcClient
	refresh chan chan struct{}

	grantMu       sync.Mutex // serialize grants to protect faucet balance and quota rollback
	syncMu        sync.Mutex // one sync at a time
	lastDiscovery time.Time
	metadata      map[string]collectibles.Metadata // by URI

	mu       sync.RWMutex
	store    storeData
	state    programState
	cards    map[string]Card
	snapshot Snapshot
	lastErr  string

	price priceCache
}

type storeData struct {
	Cursor string  `json:"cursor"`
	Events []Event `json:"events"`
	// Grants holds recent mint/faucet timestamps (unix ms) by rate-limit key.
	Grants map[string][]int64 `json:"grants,omitempty"`
}

func New(opts Options) (*Service, error) {
	if !collectibles.ValidAddress(opts.ProgramID) {
		return nil, errors.New("market: invalid program id")
	}
	if opts.Poll <= 0 {
		opts.Poll = 5 * time.Second
	}
	if opts.Discovery <= 0 {
		opts.Discovery = 60 * time.Second
	}
	if opts.MetadataHosts == nil {
		opts.MetadataHosts = collectibles.DefaultMetadataHosts()
	}
	if opts.HTTP == nil {
		opts.HTTP = &http.Client{Timeout: 15 * time.Second}
	}
	s := &Service{
		opts: opts, rpc: &rpcClient{url: opts.RPCURL, http: opts.HTTP},
		refresh: make(chan chan struct{}, 8), metadata: map[string]collectibles.Metadata{}, cards: map[string]Card{},
	}
	if opts.StorePath != "" {
		raw, err := os.ReadFile(opts.StorePath)
		switch {
		case err == nil:
			if err := json.Unmarshal(raw, &s.store); err != nil {
				return nil, errors.New("market: corrupt store " + opts.StorePath)
			}
		case !errors.Is(err, os.ErrNotExist):
			return nil, err
		}
	}
	s.snapshot = build(opts.ProgramID, programState{}, nil, s.store.Events)
	s.snapshot.Onboarding = s.onboarding()
	return s, nil
}

// Run syncs until ctx ends: every Poll interval, or at once when Refresh is called.
func (s *Service) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		var waiters []chan struct{}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case done := <-s.refresh:
			waiters = append(waiters, done)
		}
		for drained := false; !drained; {
			select {
			case done := <-s.refresh:
				waiters = append(waiters, done)
			default:
				drained = true
			}
		}
		syncCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		if err := s.Sync(syncCtx, len(waiters) > 0); err != nil {
			log.Printf("market sync: %v", err)
		}
		cancel()
		for _, done := range waiters {
			close(done)
		}
		timer.Reset(s.opts.Poll)
	}
}

// Refresh asks Run for an immediate sync and waits for it (or ctx).
func (s *Service) Refresh(ctx context.Context) {
	done := make(chan struct{})
	select {
	case s.refresh <- done:
	default:
		return // a sync is already queued
	}
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (s *Service) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshot
}

// Sync reads program accounts, new events and card owners, then rebuilds the snapshot.
func (s *Service) Sync(ctx context.Context, discover bool) error {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()

	accounts, err := s.rpc.programAccounts(ctx, s.opts.ProgramID, nil)
	if err != nil {
		s.fail(err)
		return err
	}
	state := decodeProgramAccounts(accounts)

	s.mu.RLock()
	cursor, cards := s.store.Cursor, make(map[string]Card, len(s.cards))
	for k, v := range s.cards {
		cards[k] = v
	}
	s.mu.RUnlock()

	events, newCursor, eventErr := s.newEvents(ctx, cursor)
	cards, cardErr := s.syncCards(ctx, state, cards, discover)

	s.mu.Lock()
	if len(events) > 0 || newCursor != cursor {
		s.store.Events = append(s.store.Events, events...)
		s.store.Cursor = newCursor
		if err := s.saveLocked(); err != nil {
			log.Printf("market store: %v", err)
		}
	}
	s.state, s.cards = state, cards
	s.snapshot = build(s.opts.ProgramID, state, cards, s.store.Events)
	s.snapshot.Ready = true
	s.snapshot.Onboarding = s.onboarding()
	s.snapshot.UpdatedAt = time.Now().UnixMilli()
	s.lastErr = ""
	if err := errors.Join(eventErr, cardErr); err != nil {
		s.lastErr = err.Error()
	}
	s.snapshot.Warning = s.lastErr
	s.mu.Unlock()
	return errors.Join(eventErr, cardErr)
}

func (s *Service) fail(err error) {
	s.mu.Lock()
	s.lastErr = err.Error()
	s.snapshot.Warning = s.lastErr
	s.mu.Unlock()
}

// newEvents returns decoded events after `cursor`, oldest first, and the new cursor.
// It stops at the first unreadable transaction so nothing is skipped.
func (s *Service) newEvents(ctx context.Context, cursor string) ([]Event, string, error) {
	sigs, err := s.rpc.signaturesSince(ctx, s.opts.ProgramID, cursor, 20)
	if err != nil {
		return nil, cursor, err
	}
	var out []Event
	for i := len(sigs) - 1; i >= 0; i-- {
		sig := sigs[i]
		if len(sig.Err) > 0 && string(sig.Err) != "null" {
			cursor = sig.Signature
			continue
		}
		tx, err := s.rpc.transaction(ctx, sig.Signature)
		if err != nil || tx == nil || tx.Meta == nil {
			if err == nil {
				err = errors.New("transaction " + sig.Signature + " not available yet")
			}
			return out, cursor, err
		}
		at := time.Now().UnixMilli()
		if tx.BlockTime != nil {
			at = *tx.BlockTime * 1000
		}
		for _, event := range decodeEvents(s.opts.ProgramID, tx.Meta.LogMessages) {
			event.Signature, event.Slot, event.At = sig.Signature, tx.Slot, at
			out = append(out, event)
		}
		cursor = sig.Signature
	}
	return out, cursor, nil
}

// syncCards rescans approved collections periodically and refreshes known owners otherwise.
func (s *Service) syncCards(ctx context.Context, state programState, cards map[string]Card, discover bool) (map[string]Card, error) {
	var errs []error
	if discover || time.Since(s.lastDiscovery) > s.opts.Discovery || len(cards) == 0 {
		found := map[string]Card{}
		for _, c := range state.Collections {
			if !c.Enabled {
				continue
			}
			accounts, err := s.rpc.programAccounts(ctx, collectibles.CoreProgram, []map[string]any{
				memcmp(0, "2"),  // Key::AssetV1 (byte 1)
				memcmp(33, "3"), // UpdateAuthority::Collection (byte 2)
				memcmp(34, c.Collection),
			})
			if err != nil {
				errs = append(errs, err)
				continue
			}
			for _, account := range accounts {
				if card, ok := s.card(ctx, account.Pubkey, account.Data, cards[account.Pubkey]); ok {
					found[card.Mint] = card
				}
			}
		}
		if len(errs) == 0 {
			s.lastDiscovery = time.Now()
			return found, nil
		}
		for k, v := range found {
			cards[k] = v
		}
	}
	keys := make([]string, 0, len(cards))
	for k := range cards {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	accounts, err := s.rpc.multipleAccounts(ctx, keys)
	if err != nil {
		return cards, errors.Join(append(errs, err)...)
	}
	next := make(map[string]Card, len(cards))
	for i, account := range accounts {
		if account == nil || account.Owner != collectibles.CoreProgram {
			continue // burned
		}
		if card, ok := s.card(ctx, keys[i], account.Data, cards[keys[i]]); ok {
			next[card.Mint] = card
		}
	}
	return next, errors.Join(errs...)
}

func (s *Service) card(ctx context.Context, mint string, data []byte, previous Card) (Card, bool) {
	parsed, err := collectibles.ParseCoreAsset(data)
	if err != nil {
		return Card{}, false
	}
	card := Card{Mint: mint, Owner: parsed.Owner, Collection: parsed.Collection, Name: parsed.Name, URI: parsed.URI}
	metadata, ok := s.metadata[parsed.URI]
	if !ok {
		metaCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		fetched, err := collectibles.FetchMetadata(metaCtx, s.opts.HTTP, parsed.URI, s.opts.MetadataHosts)
		cancel()
		if err == nil {
			s.metadata[parsed.URI], metadata, ok = fetched, fetched, true
		}
	}
	if ok {
		card.Image, card.Attributes = metadata.Image, metadata.Attributes
		if metadata.Name != "" {
			card.Name = metadata.Name
		}
	} else if previous.Image != "" {
		card.Image, card.Attributes = previous.Image, previous.Attributes
	}
	return card, true
}

func (s *Service) saveLocked() error {
	if s.opts.StorePath == "" {
		return nil
	}
	raw, err := json.Marshal(s.store)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.opts.StorePath), 0o755); err != nil {
		return err
	}
	tmp := s.opts.StorePath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.opts.StorePath)
}

func (s *Service) onboarding() Onboarding {
	m := s.opts.Minter
	if m == nil {
		return Onboarding{}
	}
	return Onboarding{Mint: len(m.Deck) > 0, Faucet: m.FaucetLamports > 0, FaucetLamports: m.FaucetLamports, Collection: m.Collection.String(), MintsPerDay: mintLimit.perOwner}
}
