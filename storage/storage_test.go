package storage

import (
	"path/filepath"
	"testing"
)

func TestNormalizeBackendSQLiteAliases(t *testing.T) {
	t.Parallel()

	cases := []string{
		"sqlite",
		"sqlite3",
		"sql",
		"persistent-sqlite",
		"persistent-sqlite3",
	}

	for _, input := range cases {
		input := input
		t.Run(input, func(t *testing.T) {
			t.Parallel()

			backend, err := NormalizeBackend(input)
			if err != nil {
				t.Fatalf("NormalizeBackend(%q) error = %v", input, err)
			}
			if backend != BackendSQLite {
				t.Fatalf("NormalizeBackend(%q) = %q, want %q", input, backend, BackendSQLite)
			}
		})
	}
}

func TestSQLiteStorePersistsValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "store.sqlite")

	storeA, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore() error = %v", err)
	}

	if err := storeA.Set("hello", "world"); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	storeB, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore() reopen error = %v", err)
	}

	v, ok := storeB.Get("hello")
	if !ok || v != "world" {
		t.Fatalf("expected persisted value after reopen, got value=%q ok=%v", v, ok)
	}
}
