package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

type Backend string

const (
	BackendMemory Backend = "memory"
	BackendDB     Backend = "db"
	BackendSQLite Backend = "sqlite"
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
	case string(BackendSQLite), "sqlite3", "sql", "persistent-sqlite", "persistent-sqlite3":
		return BackendSQLite, nil
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
	case BackendSQLite:
		if dataPath == "" {
			return nil, errors.New("data path is required for sqlite backend")
		}
		return NewSQLiteStore(dataPath)
	default:
		return nil, fmt.Errorf("unsupported storage backend %q", backend)
	}
}

type SQLiteStore struct {
	db *sql.DB
}

func NewSQLiteStore(path string) (*SQLiteStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS kv (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &SQLiteStore{db: db}, nil
}

func (s *SQLiteStore) Get(key string) (string, bool) {
	var value string
	err := s.db.QueryRow("SELECT value FROM kv WHERE key = ?", key).Scan(&value)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false
		}
		return "", false
	}
	return value, true
}

func (s *SQLiteStore) Set(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO kv (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
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
