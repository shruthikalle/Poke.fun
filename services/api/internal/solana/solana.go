// Package solana builds, signs and sends simple legacy Solana transactions
// for server-side wallets (the devnet card minter and SOL faucet). It covers
// only what the API needs: system transfers and Metaplex Core asset creation.
package solana

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/shruthikalle/Poke.fun/services/api/internal/collectibles"
)

const (
	SystemProgram = "11111111111111111111111111111111"
	CoreProgram   = collectibles.CoreProgram
)

// Key is a 32-byte public key.
type Key [32]byte

func (k Key) String() string { return collectibles.Encode58(k[:]) }

func ParseKey(s string) (Key, error) {
	raw, err := collectibles.Decode58(s)
	if err != nil || len(raw) != 32 {
		return Key{}, fmt.Errorf("invalid Solana address %q", s)
	}
	var k Key
	copy(k[:], raw)
	return k, nil
}

func MustKey(s string) Key {
	k, err := ParseKey(s)
	if err != nil {
		panic(err)
	}
	return k
}

// Keypair is a signing wallet.
type Keypair struct {
	Private ed25519.PrivateKey
	Public  Key
}

func NewKeypair() Keypair {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	var k Key
	copy(k[:], pub)
	return Keypair{Private: priv, Public: k}
}

// ParseKeypair reads the solana-keygen JSON format (a 64-number array).
func ParseKeypair(raw string) (Keypair, error) {
	var numbers []int
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &numbers); err != nil {
		return Keypair{}, errors.New("keypair must be a solana-keygen JSON array")
	}
	keyBytes := make([]byte, 0, len(numbers))
	for _, n := range numbers {
		if n < 0 || n > 255 {
			return Keypair{}, errors.New("keypair byte out of range")
		}
		keyBytes = append(keyBytes, byte(n))
	}
	if len(keyBytes) != 64 {
		return Keypair{}, errors.New("keypair must have 64 bytes")
	}
	priv := ed25519.NewKeyFromSeed(keyBytes[:32])
	var pub Key
	copy(pub[:], priv.Public().(ed25519.PublicKey))
	if !bytes.Equal(pub[:], keyBytes[32:]) {
		return Keypair{}, errors.New("keypair public key does not match its seed")
	}
	return Keypair{Private: priv, Public: pub}, nil
}

// LoadKeypair reads a keypair from an env value: inline JSON, or a path to a JSON file.
func LoadKeypair(value string) (Keypair, error) {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "[") {
		return ParseKeypair(value)
	}
	raw, err := os.ReadFile(value)
	if err != nil {
		return Keypair{}, err
	}
	return ParseKeypair(string(raw))
}

// AccountMeta is one instruction account.
type AccountMeta struct {
	Key      Key
	Signer   bool
	Writable bool
}

type Instruction struct {
	Program  Key
	Accounts []AccountMeta
	Data     []byte
}

// Transfer moves lamports between system accounts.
func Transfer(from, to Key, lamports uint64) Instruction {
	data := make([]byte, 12)
	binary.LittleEndian.PutUint32(data, 2)
	binary.LittleEndian.PutUint64(data[4:], lamports)
	return Instruction{Program: MustKey(SystemProgram), Data: data, Accounts: []AccountMeta{
		{Key: from, Signer: true, Writable: true}, {Key: to, Writable: true},
	}}
}

func borshString(s string) []byte {
	out := make([]byte, 4+len(s))
	binary.LittleEndian.PutUint32(out, uint32(len(s)))
	copy(out[4:], s)
	return out
}

// CreateCoreAsset is Metaplex Core CreateV1 for an asset in `collection`, signed by
// the collection's update authority, owned by `owner`, with no plugins.
func CreateCoreAsset(asset, collection, authority, payer, owner Key, name, uri string) Instruction {
	core := MustKey(CoreProgram)
	data := []byte{0, 0} // CreateV1, DataState::AccountState
	data = append(data, borshString(name)...)
	data = append(data, borshString(uri)...)
	data = append(data, 0) // plugins: None
	return Instruction{Program: core, Data: data, Accounts: []AccountMeta{
		{Key: asset, Signer: true, Writable: true},
		{Key: collection, Writable: true},
		{Key: authority, Signer: true},
		{Key: payer, Signer: true, Writable: true},
		{Key: owner},
		{Key: core}, // update authority: none (the collection governs it)
		{Key: MustKey(SystemProgram)},
		{Key: core}, // log wrapper: none
	}}
}

func shortVec(n int) []byte {
	var out []byte
	for {
		b := byte(n & 0x7f)
		n >>= 7
		if n == 0 {
			return append(out, b)
		}
		out = append(out, b|0x80)
	}
}

// Compile builds and signs a legacy transaction. The first signer pays fees.
func Compile(blockhash Key, instructions []Instruction, signers ...Keypair) ([]byte, error) {
	if len(signers) == 0 {
		return nil, errors.New("a transaction needs a fee payer")
	}
	type entry struct {
		key              Key
		signer, writable bool
	}
	var order []Key
	index := map[Key]*entry{}
	add := func(k Key, signer, writable bool) {
		if e, ok := index[k]; ok {
			e.signer, e.writable = e.signer || signer, e.writable || writable
			return
		}
		index[k] = &entry{k, signer, writable}
		order = append(order, k)
	}
	add(signers[0].Public, true, true)
	for _, ix := range instructions {
		for _, a := range ix.Accounts {
			add(a.Key, a.Signer, a.Writable)
		}
		add(ix.Program, false, false)
	}
	var groups [4][]Key // writable signers, readonly signers, writable, readonly
	for _, k := range order {
		e := index[k]
		g := 3
		switch {
		case e.signer && e.writable:
			g = 0
		case e.signer:
			g = 1
		case e.writable:
			g = 2
		}
		groups[g] = append(groups[g], k)
	}
	keys := append(append(append(append([]Key{}, groups[0]...), groups[1]...), groups[2]...), groups[3]...)
	position := map[Key]int{}
	for i, k := range keys {
		position[k] = i
	}
	numSigners := len(groups[0]) + len(groups[1])
	keyring := map[Key]Keypair{}
	for _, s := range signers {
		keyring[s.Public] = s
	}
	for _, k := range keys[:numSigners] {
		if _, ok := keyring[k]; !ok {
			return nil, fmt.Errorf("missing signer %s", k)
		}
	}

	msg := []byte{byte(numSigners), byte(len(groups[1])), byte(len(groups[3]))}
	msg = append(msg, shortVec(len(keys))...)
	for _, k := range keys {
		msg = append(msg, k[:]...)
	}
	msg = append(msg, blockhash[:]...)
	msg = append(msg, shortVec(len(instructions))...)
	for _, ix := range instructions {
		msg = append(msg, byte(position[ix.Program]))
		msg = append(msg, shortVec(len(ix.Accounts))...)
		for _, a := range ix.Accounts {
			msg = append(msg, byte(position[a.Key]))
		}
		msg = append(msg, shortVec(len(ix.Data))...)
		msg = append(msg, ix.Data...)
	}
	tx := shortVec(numSigners)
	for _, k := range keys[:numSigners] {
		tx = append(tx, ed25519.Sign(keyring[k].Private, msg)...)
	}
	if len(tx)+len(msg) > 1232 {
		return nil, errors.New("transaction too large")
	}
	return append(tx, msg...), nil
}

// Client talks to a Solana JSON-RPC endpoint.
type Client struct {
	URL  string
	HTTP *http.Client
}

func NewClient(url string) *Client {
	return &Client{URL: url, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) call(ctx context.Context, method string, params []any, out any) error {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("solana rpc %s: %w", method, err)
	}
	defer res.Body.Close()
	var envelope struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&envelope); err != nil {
		return fmt.Errorf("solana rpc %s: %w", method, err)
	}
	if envelope.Error != nil {
		return fmt.Errorf("solana rpc %s: %s", method, envelope.Error.Message)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(envelope.Result, out)
}

// CheckDevnet prevents the onboarding wallet from spending real mainnet funds.
// Loopback validators are supported for integration tests and local development.
func (c *Client) CheckDevnet(ctx context.Context) error {
	endpoint, err := url.Parse(c.URL)
	if err != nil {
		return err
	}
	var genesis string
	if err := c.call(ctx, "getGenesisHash", []any{}, &genesis); err != nil {
		return err
	}
	if genesis == "EtWTRABZaYq6iMfeYKouRu166VU2xqa1" {
		return nil
	}
	if genesis != "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" && (endpoint.Hostname() == "localhost" || endpoint.Hostname() == "127.0.0.1" || endpoint.Hostname() == "::1") {
		return nil
	}
	return errors.New("card minting and SOL faucet require Solana devnet or a loopback test validator")
}

func (c *Client) LatestBlockhash(ctx context.Context) (Key, error) {
	var out struct {
		Value struct {
			Blockhash string `json:"blockhash"`
		} `json:"value"`
	}
	if err := c.call(ctx, "getLatestBlockhash", []any{map[string]string{"commitment": "confirmed"}}, &out); err != nil {
		return Key{}, err
	}
	return ParseKey(out.Value.Blockhash)
}

func (c *Client) Balance(ctx context.Context, account Key) (uint64, error) {
	var out struct {
		Value uint64 `json:"value"`
	}
	err := c.call(ctx, "getBalance", []any{account.String(), map[string]string{"commitment": "confirmed"}}, &out)
	return out.Value, err
}

// Send submits a signed transaction (with preflight) and waits for confirmation.
func (c *Client) Send(ctx context.Context, tx []byte) (string, error) {
	var signature string
	if err := c.call(ctx, "sendTransaction", []any{base64.StdEncoding.EncodeToString(tx), map[string]any{"encoding": "base64", "preflightCommitment": "confirmed"}}, &signature); err != nil {
		return "", err
	}
	for {
		var out struct {
			Value []*struct {
				Err                json.RawMessage `json:"err"`
				ConfirmationStatus string          `json:"confirmationStatus"`
			} `json:"value"`
		}
		if err := c.call(ctx, "getSignatureStatuses", []any{[]string{signature}}, &out); err == nil && len(out.Value) == 1 && out.Value[0] != nil {
			status := out.Value[0]
			if len(status.Err) > 0 && string(status.Err) != "null" {
				return signature, fmt.Errorf("transaction %s failed: %s", signature, status.Err)
			}
			if status.ConfirmationStatus == "confirmed" || status.ConfirmationStatus == "finalized" {
				return signature, nil
			}
		}
		select {
		case <-ctx.Done():
			return signature, fmt.Errorf("transaction %s not confirmed: %w", signature, ctx.Err())
		case <-time.After(700 * time.Millisecond):
		}
	}
}

// Execute compiles with a fresh blockhash, sends and confirms.
func (c *Client) Execute(ctx context.Context, instructions []Instruction, signers ...Keypair) (string, error) {
	blockhash, err := c.LatestBlockhash(ctx)
	if err != nil {
		return "", err
	}
	tx, err := Compile(blockhash, instructions, signers...)
	if err != nil {
		return "", err
	}
	return c.Send(ctx, tx)
}
