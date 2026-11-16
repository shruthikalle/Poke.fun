// Package gamestore stores a single server's private game checkpoint. It must
// not be served as a static asset or shared by multiple server processes.
package gamestore

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
)

type envelope struct {
	Version  int             `json:"version"`
	Checksum string          `json:"checksum"`
	State    json.RawMessage `json:"state"`
}

type Store struct {
	mu   sync.Mutex
	path string
	data json.RawMessage
}

// Open fails closed on a malformed or checksum-mismatched store. Missing files
// start empty; an empty path explicitly selects memory-only storage.
func Open(path string) (*Store, error) {
	s := &Store{path: path}
	if path == "" {
		return s, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var saved envelope
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&saved) != nil || decoder.Decode(new(any)) != io.EOF || saved.Version != 1 || !json.Valid(saved.State) || bytes.Equal(saved.State, []byte("null")) || saved.Checksum != checksum(saved.State) {
		return nil, errors.New("invalid game store")
	}
	s.data = append(json.RawMessage(nil), saved.State...)
	return s, nil
}

func (s *Store) Load() (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append(json.RawMessage(nil), s.data...), nil
}

// Save syncs a private temporary file, atomically replaces the checkpoint, then
// syncs its parent directory before acknowledging durability. Failed writes
// retain the preceding checkpoint. Unchanged checkpoints do not write to disk.
func (s *Store) Save(data json.RawMessage) error {
	if !json.Valid(data) || bytes.Equal(data, []byte("null")) {
		return errors.New("invalid game checkpoint")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if bytes.Equal(s.data, data) {
		return nil
	}
	if s.path != "" {
		if err := s.save(data); err != nil {
			return err
		}
	}
	s.data = append(json.RawMessage(nil), data...)
	return nil
}

func checksum(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s *Store) save(data json.RawMessage) error {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".games-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	err = json.NewEncoder(file).Encode(envelope{Version: 1, Checksum: checksum(data), State: data})
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(file.Name(), s.path); err != nil {
		return err
	}
	parent, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}
