package collectibles

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func coreAccount(owner, collection []byte, uri string) []byte {
	data := append([]byte{1}, owner...)
	data = append(data, 2)
	data = append(data, collection...)
	for _, value := range []string{"Poke.fun Devnet Test Pikachu", uri} {
		length := make([]byte, 4)
		binary.LittleEndian.PutUint32(length, uint32(len(value)))
		data = append(data, length...)
		data = append(data, value...)
	}
	return append(data, 0) // None sequence number.
}

func TestReaderVerifiesCoreOwnerCollectionAndMetadata(t *testing.T) {
	ownerBytes := bytes.Repeat([]byte{3}, 32)
	collectionBytes := bytes.Repeat([]byte{4}, 32)
	owner := encode58(ownerBytes)
	collection := encode58(collectionBytes)
	asset := encode58(bytes.Repeat([]byte{5}, 32))
	accountData := coreAccount(ownerBytes, collectionBytes, "https://gateway.irys.xyz/card.json")
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Method != "getAccountInfo" {
			t.Error("expected getAccountInfo")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"value": map[string]any{
			"owner": coreProgram, "data": []string{base64.StdEncoding.EncodeToString(accountData), "base64"},
		}}})
	}))
	defer rpc.Close()
	reader := NewReader(rpc.URL, collection)
	reader.HTTP = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "gateway.irys.xyz" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString(`{"name":"Pikachu","image":"https://example.com/card.png","attributes":[{"trait_type":"Card Name","value":"Pikachu"}]}`)), Header: make(http.Header)}, nil
		}
		return http.DefaultTransport.RoundTrip(req)
	})}
	card, err := reader.Read(context.Background(), asset, owner)
	if err != nil {
		t.Fatal(err)
	}
	if card.ID != asset || card.Owner != owner || card.Collection != collection || card.Attribute("Card Name") != "Pikachu" || card.Image == "" {
		t.Fatalf("unexpected card: %+v", card)
	}
	if _, err := reader.Read(context.Background(), asset, encode58(bytes.Repeat([]byte{6}, 32))); err != ErrWrongOwner {
		t.Fatalf("expected owner rejection, got %v", err)
	}
	reader.Collection = encode58(bytes.Repeat([]byte{7}, 32))
	if _, err := reader.Read(context.Background(), asset, owner); err != ErrWrongCollection {
		t.Fatalf("expected collection rejection, got %v", err)
	}
	reader.Collection = collection
	accountData = coreAccount(ownerBytes, collectionBytes, "http://127.0.0.1/private")
	if _, err := reader.Read(context.Background(), asset, owner); err == nil {
		t.Fatal("accepted untrusted metadata URL")
	}
}

func TestParseCoreRejectsWrongAssetType(t *testing.T) {
	if _, err := parseCoreAsset([]byte{5}); err != ErrUnsupported {
		t.Fatalf("got %v", err)
	}
	for _, value := range []string{"", "not-a-wallet", "1111111111111111111111111111111"} {
		if validAddress(value) {
			t.Fatalf("accepted %q", value)
		}
	}
	reader := NewReader("https://api.devnet.solana.com", encode58(bytes.Repeat([]byte{4}, 32)))
	if _, err := reader.Read(context.Background(), "bad-asset", encode58(bytes.Repeat([]byte{3}, 32))); err != ErrInvalidAddress {
		t.Fatalf("expected invalid address, got %v", err)
	}
}
