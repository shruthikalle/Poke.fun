package collectibles

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const coreProgram = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

var ErrNotFound = errors.New("NFT account not found")
var ErrInvalidAddress = errors.New("invalid Solana address")
var ErrWrongOwner = errors.New("NFT is not owned by this wallet")
var ErrWrongCollection = errors.New("NFT is not in the configured collection")
var ErrUnsupported = errors.New("NFT is not a Metaplex Core asset")

type Attribute struct {
	TraitType string `json:"trait_type"`
	Value     string `json:"value"`
}

type Card struct {
	ID         string      `json:"id"`
	Owner      string      `json:"owner"`
	Collection string      `json:"collection"`
	Name       string      `json:"name"`
	URI        string      `json:"uri"`
	Image      string      `json:"image,omitempty"`
	Attributes []Attribute `json:"attributes"`
}

func (c Card) Attribute(name string) string {
	for _, a := range c.Attributes {
		if a.TraitType == name {
			return a.Value
		}
	}
	return ""
}

type Reader struct {
	RPCURL       string
	Collection   string
	AllowedHosts map[string]bool
	HTTP         *http.Client
}

func NewReader(rpcURL, collection string) *Reader {
	return &Reader{
		RPCURL: rpcURL, Collection: collection,
		AllowedHosts: map[string]bool{"gateway.irys.xyz": true, "arweave.net": true},
		HTTP: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 3 || !allowedMetadataURL(req.URL, map[string]bool{"gateway.irys.xyz": true, "arweave.net": true}) {
				return errors.New("NFT metadata redirected to an untrusted host")
			}
			return nil
		}},
	}
}

// collections parses Collection: one or more comma/space-separated collection addresses.
func (r *Reader) collections() map[string]bool {
	out := map[string]bool{}
	for _, c := range strings.FieldsFunc(r.Collection, func(c rune) bool { return c == ',' || c == ' ' || c == '\n' || c == '\t' }) {
		if validAddress(c) {
			out[c] = true
		}
	}
	return out
}

// Read checks the on-chain Core program, owner and collection before using off-chain display metadata.
func (r *Reader) Read(ctx context.Context, assetID, expectedOwner string) (Card, error) {
	if !validAddress(assetID) || !validAddress(expectedOwner) || len(r.collections()) == 0 {
		return Card{}, ErrInvalidAddress
	}
	query := struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Method  string `json:"method"`
		Params  []any  `json:"params"`
	}{"2.0", 1, "getAccountInfo", []any{assetID, map[string]any{"encoding": "base64", "commitment": "confirmed"}}}
	body, _ := json.Marshal(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.RPCURL, bytes.NewReader(body))
	if err != nil {
		return Card{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := r.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(req)
	if err != nil {
		return Card{}, fmt.Errorf("Solana RPC: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Card{}, fmt.Errorf("Solana RPC returned %d", response.StatusCode)
	}
	var result struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Result struct {
			Value *struct {
				Owner string   `json:"owner"`
				Data  []string `json:"data"`
			} `json:"value"`
		} `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return Card{}, fmt.Errorf("invalid Solana RPC response: %w", err)
	}
	if result.Error != nil {
		return Card{}, fmt.Errorf("Solana RPC: %s", result.Error.Message)
	}
	if result.Result.Value == nil {
		return Card{}, ErrNotFound
	}
	if result.Result.Value.Owner != coreProgram || len(result.Result.Value.Data) != 2 || result.Result.Value.Data[1] != "base64" {
		return Card{}, ErrUnsupported
	}
	raw, err := base64.StdEncoding.DecodeString(result.Result.Value.Data[0])
	if err != nil {
		return Card{}, fmt.Errorf("invalid asset account: %w", err)
	}
	card, err := parseCoreAsset(raw)
	if err != nil {
		return Card{}, err
	}
	card.ID = assetID
	if card.Owner != expectedOwner {
		return Card{}, ErrWrongOwner
	}
	if !r.collections()[card.Collection] {
		return Card{}, ErrWrongCollection
	}
	uri, err := url.Parse(card.URI)
	if err != nil || !allowedMetadataURL(uri, r.AllowedHosts) {
		return Card{}, errors.New("NFT metadata host is not allowed")
	}
	metadataRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, card.URI, nil)
	if err != nil {
		return Card{}, err
	}
	metadataResponse, err := client.Do(metadataRequest)
	if err != nil {
		return Card{}, fmt.Errorf("NFT metadata: %w", err)
	}
	defer metadataResponse.Body.Close()
	if metadataResponse.StatusCode != http.StatusOK {
		return Card{}, fmt.Errorf("NFT metadata returned %d", metadataResponse.StatusCode)
	}
	var metadata struct {
		Name       string      `json:"name"`
		Image      string      `json:"image"`
		Attributes []Attribute `json:"attributes"`
	}
	if err := json.NewDecoder(io.LimitReader(metadataResponse.Body, 64<<10)).Decode(&metadata); err != nil {
		return Card{}, fmt.Errorf("invalid NFT metadata: %w", err)
	}
	card.Image = metadata.Image
	card.Attributes = metadata.Attributes
	return card, nil
}

func allowedMetadataURL(uri *url.URL, hosts map[string]bool) bool {
	if uri == nil || uri.Scheme != "https" || uri.User != nil || uri.Port() != "" {
		return false
	}
	host := strings.ToLower(uri.Hostname())
	return hosts[host] || strings.HasSuffix(host, ".devnet-1.datasprite-cdn.com")
}

func parseCoreAsset(raw []byte) (Card, error) {
	if len(raw) < 34 || raw[0] != 1 { // Metaplex Core AssetV1 discriminator.
		return Card{}, ErrUnsupported
	}
	card := Card{Owner: encode58(raw[1:33])}
	offset := 34
	switch raw[33] {
	case 2: // Collection update authority.
		if len(raw) < offset+32 {
			return Card{}, ErrUnsupported
		}
		card.Collection = encode58(raw[offset : offset+32])
		offset += 32
	case 1: // Address update authority; no verified collection.
		offset += 32
	case 0: // No update authority or collection.
	default:
		return Card{}, ErrUnsupported
	}
	if offset > len(raw) {
		return Card{}, ErrUnsupported
	}
	name, next, err := readString(raw, offset)
	if err != nil {
		return Card{}, err
	}
	uri, _, err := readString(raw, next)
	if err != nil {
		return Card{}, err
	}
	card.Name, card.URI = name, uri
	return card, nil
}

func readString(data []byte, offset int) (string, int, error) {
	if offset+4 > len(data) {
		return "", 0, ErrUnsupported
	}
	size := int(binary.LittleEndian.Uint32(data[offset:]))
	if size > 4096 || size > len(data)-offset-4 {
		return "", 0, ErrUnsupported
	}
	return string(data[offset+4 : offset+4+size]), offset + 4 + size, nil
}

func validAddress(value string) bool {
	decoded, err := decode58(value)
	return err == nil && len(decoded) == 32 && encode58(decoded) == value
}

func encode58(data []byte) string {
	n := new(big.Int).SetBytes(data)
	base := big.NewInt(58)
	zero := new(big.Int)
	var out []byte
	for n.Cmp(zero) > 0 {
		rem := new(big.Int)
		n.DivMod(n, base, rem)
		out = append(out, alphabet[rem.Int64()])
	}
	for _, b := range data {
		if b != 0 {
			break
		}
		out = append(out, '1')
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return string(out)
}

func decode58(value string) ([]byte, error) {
	n := new(big.Int)
	for _, c := range value {
		index := strings.IndexRune(alphabet, c)
		if index < 0 {
			return nil, errors.New("invalid base58")
		}
		n.Mul(n, big.NewInt(58))
		n.Add(n, big.NewInt(int64(index)))
	}
	out := n.Bytes()
	for _, c := range value {
		if c != '1' {
			break
		}
		out = append([]byte{0}, out...)
	}
	return out, nil
}
