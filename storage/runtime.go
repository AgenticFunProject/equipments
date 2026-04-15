package storage

import (
	"fmt"
	"os"
)

const (
	StorageBackendEnv = "STORAGE_BACKEND"
	StoragePathEnv    = "STORAGE_DB_PATH"
	StorageSQLiteEnv  = "STORAGE_SQLITE_PATH"
)

type RuntimeConfig struct {
	Backend Backend
	Path    string
}

func LoadRuntimeConfig() (RuntimeConfig, error) {
	raw := os.Getenv(StorageBackendEnv)
	backend, err := NormalizeBackend(raw)
	if err != nil {
		return RuntimeConfig{}, err
	}

	cfg := RuntimeConfig{Backend: backend}
	if backend == BackendDB {
		cfg.Path = os.Getenv(StoragePathEnv)
		if cfg.Path == "" {
			return RuntimeConfig{}, fmt.Errorf("%s is required when %s=%s", StoragePathEnv, StorageBackendEnv, BackendDB)
		}
	}

	if backend == BackendSQLite {
		cfg.Path = os.Getenv(StorageSQLiteEnv)
		if cfg.Path == "" {
			cfg.Path = os.Getenv(StoragePathEnv)
		}
		if cfg.Path == "" {
			return RuntimeConfig{}, fmt.Errorf("%s or %s is required when %s=%s", StorageSQLiteEnv, StoragePathEnv, StorageBackendEnv, BackendSQLite)
		}
	}

	return cfg, nil
}

func NewFromRuntimeConfig() (Store, RuntimeConfig, error) {
	cfg, err := LoadRuntimeConfig()
	if err != nil {
		return nil, RuntimeConfig{}, err
	}

	store, err := New(cfg.Backend, cfg.Path)
	if err != nil {
		return nil, RuntimeConfig{}, err
	}

	return store, cfg, nil
}
