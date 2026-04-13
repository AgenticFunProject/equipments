package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Backend string

const (
	BackendMemory Backend = "memory"
	BackendDB     Backend = "db"
)

type Store interface {
	Get(key string) (string, bool)
	Set(key, value string) error
}

func NormalizeBackend(raw string) (Backend, error) {
	switch raw {
	case "", string(BackendMemory):
		return BackendMemory, nil
	case string(BackendDB), "persistent", "persistent-db":
		return BackendDB, nil
	default:
		return "", fmt.Errorf("unsupported storage backend %q", raw)
	}
}

func New(backend Backend, dataPath string) (Store, error) {
	switch backend {
	case BackendMemory:
		return NewMemoryStore(), nil
	case BackendDB:
		if dataPath == "" {
			return nil, errors.New("data path is required for db backend")
		}
		return NewPersistentStore(dataPath)
	default:
		return nil, fmt.Errorf("unsupported storage backend %q", backend)
	}
}

type MemoryStore struct {
	mu    sync.RWMutex
	items map[string]string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{items: make(map[string]string)}
}

func (s *MemoryStore) Get(key string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.items[key]
	return v, ok
}

func (s *MemoryStore) Set(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[key] = value
	return nil
}

type PersistentStore struct {
	mu    sync.RWMutex
	path  string
	items map[string]string
}

func NewPersistentStore(path string) (*PersistentStore, error) {
	s := &PersistentStore{path: path, items: make(map[string]string)}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *PersistentStore) load() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if len(b) == 0 {
		return nil
	}

	return json.Unmarshal(b, &s.items)
}

func (s *PersistentStore) persist() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(s.items)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o644)
}

func (s *PersistentStore) Get(key string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.items[key]
	return v, ok
}

func (s *PersistentStore) Set(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[key] = value
	return s.persist()
}
