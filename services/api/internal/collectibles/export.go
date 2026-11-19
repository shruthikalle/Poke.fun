package collectibles

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// CoreProgram is the Metaplex Core program address.
const CoreProgram = coreProgram

// DefaultMetadataHosts are the off-chain metadata hosts trusted for display data.
func DefaultMetadataHosts() map[string]bool {
	return map[string]bool{"gateway.irys.xyz": true, "arweave.net": true}
}

// ParseCoreAsset decodes the owner, collection, name and URI of a Core AssetV1 account.
func ParseCoreAsset(raw []byte) (Card, error) { return parseCoreAsset(raw) }

func Encode58(data []byte) string           { return encode58(data) }
func Decode58(value string) ([]byte, error) { return decode58(value) }
func ValidAddress(value string) bool        { return validAddress(value) }

// Metadata is the display part of an NFT's off-chain JSON.
type Metadata struct {
	Name       string      `json:"name"`
	Image      string      `json:"image"`
	Attributes []Attribute `json:"attributes"`
}

// FetchMetadata reads off-chain JSON from a trusted HTTPS host.
func FetchMetadata(ctx context.Context, client *http.Client, uri string, hosts map[string]bool) (Metadata, error) {
	parsed, err := url.Parse(uri)
	if err != nil || !allowedMetadataURL(parsed, hosts) {
		return Metadata{}, errors.New("NFT metadata host is not allowed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return Metadata{}, err
	}
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return Metadata{}, fmt.Errorf("NFT metadata: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Metadata{}, fmt.Errorf("NFT metadata returned %d", res.StatusCode)
	}
	var metadata Metadata
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&metadata); err != nil {
		return Metadata{}, fmt.Errorf("invalid NFT metadata: %w", err)
	}
	return metadata, nil
}
