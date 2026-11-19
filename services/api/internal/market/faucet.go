package market

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net"
	"net/http"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
	"github.com/shruthikalle/Poke.fun/services/api/internal/solana"
)

// Devnet onboarding: the server's minter wallet (the update authority of the
// marketplace's own card collection) mints free test cards into any wallet and
// tops up wallets with a little devnet SOL, since the public RPC faucet is closed.

//go:embed deck.json
var defaultDeck []byte

// DeckCard is one mintable card: its display name and its trusted off-chain metadata.
type DeckCard struct {
	Name string `json:"name"`
	URI  string `json:"uri"`
}

type Minter struct {
	Wallet     solana.Keypair
	Collection solana.Key
	RPC        *solana.Client
	Deck       []DeckCard
	// Faucet amount per grant and the balance above which no SOL is sent.
	FaucetLamports  uint64
	FaucetThreshold uint64
	// Reserve kept in the minter wallet for minting fees.
	Reserve uint64
}

func DefaultDeck() []DeckCard {
	var deck []DeckCard
	_ = json.Unmarshal(defaultDeck, &deck)
	return deck
}

type limit struct {
	perOwner, perIP, global int
	window                  time.Duration
}

var (
	mintLimit   = limit{perOwner: 3, perIP: 12, global: 400, window: 24 * time.Hour}
	faucetLimit = limit{perOwner: 1, perIP: 4, global: 60, window: 12 * time.Hour}
)

var errLimited = errors.New("rate limited")

// allowLocked records a grant if it fits the limits.
func (s *Service) allowLocked(kind, owner, ip string, l limit) error {
	now := time.Now()
	since := now.Add(-l.window).UnixMilli()
	if s.store.Grants == nil {
		s.store.Grants = map[string][]int64{}
	}
	count := func(key string) int {
		kept := s.store.Grants[key][:0]
		for _, at := range s.store.Grants[key] {
			if at >= since {
				kept = append(kept, at)
			}
		}
		s.store.Grants[key] = kept
		if len(kept) == 0 {
			delete(s.store.Grants, key)
		}
		return len(kept)
	}
	if count(kind+":owner:"+owner) >= l.perOwner || count(kind+":ip:"+ip) >= l.perIP || count(kind+":all") >= l.global {
		return errLimited
	}
	for _, key := range []string{kind + ":owner:" + owner, kind + ":ip:" + ip, kind + ":all"} {
		s.store.Grants[key] = append(s.store.Grants[key], now.UnixMilli())
	}
	return s.saveLocked()
}

// releaseLocked undoes the most recent grant after a failed transaction.
func (s *Service) releaseLocked(kind, owner, ip string) {
	for _, key := range []string{kind + ":owner:" + owner, kind + ":ip:" + ip, kind + ":all"} {
		if list := s.store.Grants[key]; len(list) > 0 {
			s.store.Grants[key] = list[:len(list)-1]
		}
	}
	_ = s.saveLocked()
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type MintResult struct {
	Mint      string `json:"mint"`
	Name      string `json:"name"`
	Signature string `json:"signature"`
}

// MintCard creates one random deck card owned by `owner` in the marketplace collection.
func (s *Service) MintCard(ctx context.Context, owner, ip string) (MintResult, error) {
	m := s.opts.Minter
	if m == nil || len(m.Deck) == 0 {
		return MintResult{}, errors.New("card minting is not configured")
	}
	s.grantMu.Lock()
	defer s.grantMu.Unlock()
	ownerKey, err := solana.ParseKey(owner)
	if err != nil {
		return MintResult{}, err
	}
	s.mu.Lock()
	err = s.allowLocked("mint", owner, ip, mintLimit)
	s.mu.Unlock()
	if err != nil {
		return MintResult{}, err
	}
	card := m.Deck[rand.IntN(len(m.Deck))]
	asset := solana.NewKeypair()
	sig, err := m.RPC.Execute(ctx, []solana.Instruction{
		solana.CreateCoreAsset(asset.Public, m.Collection, m.Wallet.Public, m.Wallet.Public, ownerKey, "Poke.fun Devnet Test "+card.Name, card.URI),
	}, m.Wallet, asset)
	if err != nil {
		s.mu.Lock()
		if sig == "" {
			s.releaseLocked("mint", owner, ip)
		}
		s.mu.Unlock()
		return MintResult{}, err
	}
	return MintResult{Mint: asset.Public.String(), Name: card.Name, Signature: sig}, nil
}

type FaucetResult struct {
	Lamports  uint64 `json:"lamports"`
	Signature string `json:"signature"`
}

var errFunded = errors.New("wallet already has enough devnet SOL")

// SendSOL tops up a low-balance wallet from the minter wallet.
func (s *Service) SendSOL(ctx context.Context, owner, ip string) (FaucetResult, error) {
	m := s.opts.Minter
	if m == nil || m.FaucetLamports == 0 {
		return FaucetResult{}, errors.New("the devnet SOL faucet is not configured")
	}
	s.grantMu.Lock()
	defer s.grantMu.Unlock()
	ownerKey, err := solana.ParseKey(owner)
	if err != nil {
		return FaucetResult{}, err
	}
	if balance, err := m.RPC.Balance(ctx, ownerKey); err != nil {
		return FaucetResult{}, err
	} else if balance >= m.FaucetThreshold {
		return FaucetResult{}, errFunded
	}
	if balance, err := m.RPC.Balance(ctx, m.Wallet.Public); err != nil {
		return FaucetResult{}, err
	} else if balance < m.FaucetLamports+m.Reserve {
		return FaucetResult{}, errors.New("the faucet is empty right now; try again later")
	}
	s.mu.Lock()
	err = s.allowLocked("sol", owner, ip, faucetLimit)
	s.mu.Unlock()
	if err != nil {
		return FaucetResult{}, err
	}
	sig, err := m.RPC.Execute(ctx, []solana.Instruction{solana.Transfer(m.Wallet.Public, ownerKey, m.FaucetLamports)}, m.Wallet)
	if err != nil {
		s.mu.Lock()
		if sig == "" {
			s.releaseLocked("sol", owner, ip)
		}
		s.mu.Unlock()
		return FaucetResult{}, err
	}
	return FaucetResult{Lamports: m.FaucetLamports, Signature: sig}, nil
}

func (s *Service) registerOnboarding(mux *http.ServeMux) {
	decode := func(w http.ResponseWriter, r *http.Request) (string, bool) {
		var body struct {
			Owner string `json:"owner"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil || !collectibles.ValidAddress(body.Owner) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "owner must be a Solana address"})
			return "", false
		}
		return body.Owner, true
	}
	fail := func(w http.ResponseWriter, err error, limited string) {
		switch {
		case errors.Is(err, errLimited):
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": limited})
		case errors.Is(err, errFunded):
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
	}
	mux.HandleFunc("POST /api/market/mint", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := decode(w, r)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		result, err := s.MintCard(ctx, owner, clientIP(r))
		if err != nil {
			fail(w, err, "You've claimed today's free cards. Come back tomorrow.")
			return
		}
		go func() {
			refreshCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
			defer done()
			s.Refresh(refreshCtx)
		}()
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /api/market/faucet", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := decode(w, r)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		result, err := s.SendSOL(ctx, owner, clientIP(r))
		if err != nil {
			fail(w, err, "You've already received devnet SOL recently. Try again later.")
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
