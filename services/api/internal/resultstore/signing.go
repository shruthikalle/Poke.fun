package resultstore

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

func loadKey(path string) (ed25519.PrivateKey, error) {
	if path == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		return key, err
	}
	seed, err := os.ReadFile(path)
	if err == nil {
		if len(seed) != ed25519.SeedSize {
			return nil, errors.New("invalid referee signing key")
		}
		return ed25519.NewKeyFromSeed(seed), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	_, writeErr := file.Write(key.Seed())
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(path)
		return nil, errors.Join(writeErr, closeErr)
	}
	return key, nil
}

// Verify checks integrity. The caller must separately trust or pin PublicKey.
func Verify(envelope Envelope) bool {
	if envelope.Algorithm != "Ed25519" || envelope.Result.validate() != nil {
		return false
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(envelope.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(envelope.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(envelope.Payload)
	if err != nil {
		return false
	}
	expected, err := json.Marshal(envelope.Result)
	return err == nil && bytes.Equal(payload, expected) && ed25519.Verify(publicKey, payload, signature)
}
