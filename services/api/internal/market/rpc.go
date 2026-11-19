package market

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// rpcClient is a minimal Solana JSON-RPC client for the calls the indexer needs.
type rpcClient struct {
	url  string
	http *http.Client
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (c *rpcClient) call(ctx context.Context, method string, params []any, out any) error {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("solana rpc %s: %w", method, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("solana rpc %s returned %d", method, res.StatusCode)
	}
	var envelope struct {
		Error  *rpcError       `json:"error"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(&envelope); err != nil {
		return fmt.Errorf("solana rpc %s: invalid response: %w", method, err)
	}
	if envelope.Error != nil {
		return fmt.Errorf("solana rpc %s: %s", method, envelope.Error.Message)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(envelope.Result, out)
}

type programAccount struct {
	Pubkey  string
	Data    []byte
	Owner   string
	Lamport uint64
}

type rawAccount struct {
	Data     []string `json:"data"`
	Owner    string   `json:"owner"`
	Lamports uint64   `json:"lamports"`
}

func (a rawAccount) bytes() ([]byte, error) {
	if len(a.Data) != 2 || a.Data[1] != "base64" {
		return nil, errors.New("unexpected account encoding")
	}
	return base64.StdEncoding.DecodeString(a.Data[0])
}

// memcmp filters use base58 bytes, as the RPC expects.
func memcmp(offset int, base58 string) map[string]any {
	return map[string]any{"memcmp": map[string]any{"offset": offset, "bytes": base58}}
}

func (c *rpcClient) programAccounts(ctx context.Context, program string, filters []map[string]any) ([]programAccount, error) {
	options := map[string]any{"encoding": "base64", "commitment": "confirmed"}
	if len(filters) > 0 {
		options["filters"] = filters
	}
	var result []struct {
		Pubkey  string     `json:"pubkey"`
		Account rawAccount `json:"account"`
	}
	if err := c.call(ctx, "getProgramAccounts", []any{program, options}, &result); err != nil {
		return nil, err
	}
	out := make([]programAccount, 0, len(result))
	for _, item := range result {
		data, err := item.Account.bytes()
		if err != nil {
			continue
		}
		out = append(out, programAccount{Pubkey: item.Pubkey, Data: data, Owner: item.Account.Owner, Lamport: item.Account.Lamports})
	}
	return out, nil
}

// multipleAccounts returns nil entries for missing accounts.
func (c *rpcClient) multipleAccounts(ctx context.Context, keys []string) ([]*programAccount, error) {
	out := make([]*programAccount, 0, len(keys))
	for start := 0; start < len(keys); start += 100 {
		end := min(start+100, len(keys))
		var result struct {
			Value []*rawAccount `json:"value"`
		}
		if err := c.call(ctx, "getMultipleAccounts", []any{keys[start:end], map[string]any{"encoding": "base64", "commitment": "confirmed"}}, &result); err != nil {
			return nil, err
		}
		for i, value := range result.Value {
			if value == nil {
				out = append(out, nil)
				continue
			}
			data, err := value.bytes()
			if err != nil {
				out = append(out, nil)
				continue
			}
			out = append(out, &programAccount{Pubkey: keys[start+i], Data: data, Owner: value.Owner, Lamport: value.Lamports})
		}
	}
	return out, nil
}

type signatureInfo struct {
	Signature string          `json:"signature"`
	Slot      uint64          `json:"slot"`
	BlockTime *int64          `json:"blockTime"`
	Err       json.RawMessage `json:"err"`
}

// signaturesSince lists signatures newer than `until`, newest first, up to `limit` pages.
func (c *rpcClient) signaturesSince(ctx context.Context, address, until string, pages int) ([]signatureInfo, error) {
	var all []signatureInfo
	before := ""
	for page := 0; page < pages; page++ {
		options := map[string]any{"limit": 1000, "commitment": "confirmed"}
		if until != "" {
			options["until"] = until
		}
		if before != "" {
			options["before"] = before
		}
		var batch []signatureInfo
		if err := c.call(ctx, "getSignaturesForAddress", []any{address, options}, &batch); err != nil {
			return nil, err
		}
		all = append(all, batch...)
		if len(batch) < 1000 {
			break
		}
		before = batch[len(batch)-1].Signature
	}
	return all, nil
}

type transactionLogs struct {
	Slot      uint64 `json:"slot"`
	BlockTime *int64 `json:"blockTime"`
	Meta      *struct {
		Err         json.RawMessage `json:"err"`
		LogMessages []string        `json:"logMessages"`
	} `json:"meta"`
}

func (c *rpcClient) transaction(ctx context.Context, signature string) (*transactionLogs, error) {
	var tx *transactionLogs
	err := c.call(ctx, "getTransaction", []any{signature, map[string]any{"encoding": "json", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}}, &tx)
	return tx, err
}
