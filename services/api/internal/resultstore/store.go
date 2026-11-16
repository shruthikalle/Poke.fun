// Package resultstore seals immutable server outcomes for a future settlement
// consumer. It never submits transactions or represents entries as funded.
package resultstore

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Store struct {
	mu      sync.Mutex
	path    string
	key     ed25519.PrivateKey
	records map[string]Envelope
}

func Open(path, keyPath string) (*Store, error) {
	if path != "" && keyPath == "" {
		return nil, errors.New("persistent results require a persistent signing key")
	}
	key, err := loadKey(keyPath)
	if err != nil {
		return nil, err
	}
	store := &Store{path: path, key: key, records: map[string]Envelope{}}
	if path == "" {
		return store, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &store.records); err != nil {
		return nil, err
	}
	if store.records == nil {
		return nil, errors.New("invalid result store")
	}
	for id, record := range store.records {
		if id != record.Result.ID || record.PublicKey != store.PublicKey() || !Verify(record) || !validReplay(record) {
			return nil, errors.New("result store contains invalid signatures or a different referee key")
		}
	}
	return store, nil
}

func (s *Store) PublicKey() string {
	return base64.RawURLEncoding.EncodeToString(s.key.Public().(ed25519.PublicKey))
}

// Seal is retry-safe. A completed round cannot later change its winner, locked
// participants or state hash. Disk failure does not publish an unsigned result.
func (s *Store) Seal(result Result) (Envelope, error) {
	return s.SealReplay(result, nil)
}

// SealReplay commits the result and its public replay together. The replay
// digest is part of the signed result, so a later edit is detectable.
func (s *Store) SealReplay(result Result, replay json.RawMessage) (Envelope, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(replay) > 0 {
		var decoded any
		if json.Unmarshal(replay, &decoded) != nil {
			return Envelope{}, errors.New("invalid replay")
		}
		canonical, _ := json.Marshal(decoded)
		digest := sha256.Sum256(canonical)
		if hex.EncodeToString(digest[:]) != result.StateHash {
			return Envelope{}, errors.New("replay does not match result hash")
		}
		replay = canonical
	}
	result = clone(Envelope{Result: result}).Result
	result.SchemaVersion = SchemaVersion
	result.Funding = "unfunded"
	result.Settlement = "not_connected"
	result.EndedAt = time.Now().UnixMilli()
	if existing, ok := s.records[result.ID]; ok {
		result.EndedAt = existing.Result.EndedAt
		current, _ := json.Marshal(result)
		previous, _ := json.Marshal(existing.Result)
		if !bytes.Equal(current, previous) || len(replay) > 0 && !bytes.Equal(existing.Replay, replay) {
			return Envelope{}, errors.New("completed result cannot be changed")
		}
		return clone(existing), nil
	}
	if err := result.validate(); err != nil {
		return Envelope{}, err
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return Envelope{}, err
	}
	envelope := Envelope{Result: result, Algorithm: "Ed25519", PublicKey: s.PublicKey(),
		Payload:   base64.RawURLEncoding.EncodeToString(payload),
		Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.key, payload)), Replay: replay}
	next := make(map[string]Envelope, len(s.records)+1)
	for id, record := range s.records {
		next[id] = record
	}
	next[result.ID] = envelope
	if err := s.save(next); err != nil {
		return Envelope{}, err
	}
	s.records = next
	return clone(envelope), nil
}

func (s *Store) Get(id string) (Envelope, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.records[id]
	return clone(record), ok
}

// List returns finished results for a public demo name, newest first.
func (s *Store) List(name string) []Envelope {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Envelope{}
	for _, record := range s.records {
		if strings.EqualFold(record.Result.Players[0].Name, name) || strings.EqualFold(record.Result.Players[1].Name, name) {
			out = append(out, clone(record))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Result.EndedAt > out[j].Result.EndedAt || out[i].Result.EndedAt == out[j].Result.EndedAt && out[i].Result.ID > out[j].Result.ID
	})
	return out
}

func validReplay(record Envelope) bool {
	if len(record.Replay) == 0 {
		return true // results written before replay support
	}
	var decoded any
	if json.Unmarshal(record.Replay, &decoded) != nil {
		return false
	}
	canonical, _ := json.Marshal(decoded)
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]) == record.Result.StateHash
}

func clone(envelope Envelope) Envelope {
	envelope.Replay = append(json.RawMessage(nil), envelope.Replay...)
	for index := range envelope.Result.Players {
		player := &envelope.Result.Players[index]
		player.Species = append([]string(nil), player.Species...)
		if player.Assets != nil {
			player.Assets = append([]string(nil), player.Assets...)
		}
	}
	return envelope
}

func (s *Store) save(records map[string]Envelope) error {
	if s.path == "" {
		return nil
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".results-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	err = json.NewEncoder(file).Encode(records)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return errors.Join(err, closeErr)
	}
	return os.Rename(file.Name(), s.path)
}
