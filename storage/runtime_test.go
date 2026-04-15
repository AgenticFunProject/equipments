package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRuntimeConfigDefaultsToMemory(t *testing.T) {
	t.Setenv(StorageBackendEnv, "")
	t.Setenv(StoragePathEnv, "")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig() error = %v", err)
	}

	if cfg.Backend != BackendMemory {
		t.Fatalf("expected backend %q, got %q", BackendMemory, cfg.Backend)
	}
	if cfg.Path != "" {
		t.Fatalf("expected empty path for memory backend, got %q", cfg.Path)
	}
}

func TestLoadRuntimeConfigDBRequiresPath(t *testing.T) {
	t.Setenv(StorageBackendEnv, string(BackendDB))
	t.Setenv(StoragePathEnv, "")

	_, err := LoadRuntimeConfig()
	if err == nil {
		t.Fatal("expected error when db backend path missing")
	}
}

func TestNewFromRuntimeConfigUsesPersistentStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "store.json")
	t.Setenv(StorageBackendEnv, string(BackendDB))
	t.Setenv(StoragePathEnv, path)

	store, cfg, err := NewFromRuntimeConfig()
	if err != nil {
		t.Fatalf("NewFromRuntimeConfig() error = %v", err)
	}

	if cfg.Backend != BackendDB {
		t.Fatalf("expected backend %q, got %q", BackendDB, cfg.Backend)
	}

	if err := store.Set("k", "v"); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected persistent file to exist: %v", err)
	}
}

func TestNewFromRuntimeConfigUsesMemoryStore(t *testing.T) {
	t.Setenv(StorageBackendEnv, string(BackendMemory))
	t.Setenv(StoragePathEnv, filepath.Join(t.TempDir(), "ignored.json"))

	store, cfg, err := NewFromRuntimeConfig()
	if err != nil {
		t.Fatalf("NewFromRuntimeConfig() error = %v", err)
	}

	if cfg.Backend != BackendMemory {
		t.Fatalf("expected backend %q, got %q", BackendMemory, cfg.Backend)
	}

	if err := store.Set("a", "b"); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	v, ok := store.Get("a")
	if !ok || v != "b" {
		t.Fatalf("expected in-memory value roundtrip, got value=%q ok=%v", v, ok)
	}
}

func TestLoadRuntimeConfigSQLiteRequiresPath(t *testing.T) {
	t.Setenv(StorageBackendEnv, string(BackendSQLite))
	t.Setenv(StorageSQLiteEnv, "")
	t.Setenv(StoragePathEnv, "")

	_, err := LoadRuntimeConfig()
	if err == nil {
		t.Fatal("expected error when sqlite backend path missing")
	}
}

func TestNewFromRuntimeConfigUsesSQLiteStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "store.sqlite")
	t.Setenv(StorageBackendEnv, "sqlite3")
	t.Setenv(StorageSQLiteEnv, path)
	t.Setenv(StoragePathEnv, "")

	store, cfg, err := NewFromRuntimeConfig()
	if err != nil {
		t.Fatalf("NewFromRuntimeConfig() error = %v", err)
	}

	if cfg.Backend != BackendSQLite {
		t.Fatalf("expected backend %q, got %q", BackendSQLite, cfg.Backend)
	}

	if err := store.Set("s", "1"); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	v, ok := store.Get("s")
	if !ok || v != "1" {
		t.Fatalf("expected sqlite value roundtrip, got value=%q ok=%v", v, ok)
	}
}
