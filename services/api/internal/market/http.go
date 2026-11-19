package market

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

// Handler serves:
//
//	GET  /api/market           full snapshot
//	POST /api/market/refresh   sync now (call after confirming a transaction), then snapshot
//	GET  /api/market/sol-price cached SOL/USD
func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/market", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.Snapshot())
	})
	mux.HandleFunc("POST /api/market/refresh", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		s.Refresh(ctx)
		writeJSON(w, http.StatusOK, s.Snapshot())
	})
	// Cards a wallet holds in approved collections (the loadout's owned-card source).
	mux.HandleFunc("GET /api/market/wallet/{owner}", func(w http.ResponseWriter, r *http.Request) {
		owner := r.PathValue("owner")
		snap := s.Snapshot()
		cards := []Card{}
		for _, c := range snap.Cards {
			if c.Owner == owner {
				cards = append(cards, c)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ready": snap.Ready, "cards": cards})
	})
	s.registerOnboarding(mux)
	mux.HandleFunc("GET /api/market/sol-price", func(w http.ResponseWriter, r *http.Request) {
		quote, err := s.price.get(r.Context(), s.opts.HTTP, s.opts.PriceURL)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "SOL price is unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, quote)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

type PriceQuote struct {
	USD       float64 `json:"usd"`
	Change24h float64 `json:"change24h"`
	At        int64   `json:"at"`
}

// priceCache keeps one quote for a minute so page loads don't hit the source.
type priceCache struct {
	mu    sync.Mutex
	quote *PriceQuote
}

func (p *priceCache) get(ctx context.Context, client *http.Client, source string) (PriceQuote, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.quote != nil && time.Since(time.UnixMilli(p.quote.At)) < time.Minute {
		return *p.quote, nil
	}
	if source == "" {
		return PriceQuote{}, errors.New("no price source")
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return PriceQuote{}, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return p.stale(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return p.stale(errors.New(res.Status))
	}
	var body struct {
		Solana struct {
			USD       float64 `json:"usd"`
			Change24h float64 `json:"usd_24h_change"`
		} `json:"solana"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&body); err != nil || body.Solana.USD <= 0 {
		return p.stale(errors.New("invalid price response"))
	}
	p.quote = &PriceQuote{USD: body.Solana.USD, Change24h: body.Solana.Change24h, At: time.Now().UnixMilli()}
	return *p.quote, nil
}

// stale serves the last good quote, if any, when the source fails.
func (p *priceCache) stale(err error) (PriceQuote, error) {
	if p.quote != nil {
		return *p.quote, nil
	}
	return PriceQuote{}, err
}
