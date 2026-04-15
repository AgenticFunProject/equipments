import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DomainError } from "./errors.js";
import type { ContainerUnit, EquipmentType, Reservation } from "./types.js";

export const StorageBackend = {
  MEMORY: "memory",
  DB: "db",
  SQLITE: "sqlite"
} as const;

export type StorageBackend = (typeof StorageBackend)[keyof typeof StorageBackend];

export const STORAGE_BACKEND_ENV = "STORAGE_BACKEND";
export const STORAGE_DB_PATH_ENV = "STORAGE_DB_PATH";
export const STORAGE_SQLITE_PATH_ENV = "STORAGE_SQLITE_PATH";

export interface StoreSnapshot {
  equipmentTypes: EquipmentType[];
  containers: ContainerUnit[];
  reservations: Reservation[];
}

export interface StorePersistence {
  load(): StoreSnapshot | null;
  save(snapshot: StoreSnapshot): void;
}

export interface RuntimeConfig {
  backend: StorageBackend;
  path: string;
}

export function normalizeBackend(raw: string | undefined): StorageBackend {
  switch (raw?.trim().toLowerCase() ?? "") {
    case "":
    case StorageBackend.MEMORY:
      return StorageBackend.MEMORY;
    case StorageBackend.DB:
    case "persistent":
    case "persistent-db":
      return StorageBackend.DB;
    case StorageBackend.SQLITE:
    case "sqlite3":
    case "sql":
    case "persistent-sqlite":
    case "persistent-sqlite3":
      return StorageBackend.SQLITE;
    default:
      throw new DomainError(`unsupported storage backend ${JSON.stringify(raw ?? "")}`);
  }
}

export function loadRuntimeConfig(env = process.env): RuntimeConfig {
  const backend = normalizeBackend(env[STORAGE_BACKEND_ENV]);
  if (backend === StorageBackend.MEMORY) {
    return { backend, path: "" };
  }

  if (backend === StorageBackend.DB) {
    const path = env[STORAGE_DB_PATH_ENV]?.trim() ?? "";
    if (!path) {
      throw new DomainError(`${STORAGE_DB_PATH_ENV} is required when ${STORAGE_BACKEND_ENV}=db`);
    }
    return { backend, path };
  }

  const path = env[STORAGE_SQLITE_PATH_ENV]?.trim() || env[STORAGE_DB_PATH_ENV]?.trim() || "";
  if (!path) {
    throw new DomainError(
      `${STORAGE_SQLITE_PATH_ENV} or ${STORAGE_DB_PATH_ENV} is required when ${STORAGE_BACKEND_ENV}=sqlite`
    );
  }

  return { backend, path };
}

export function createPersistence(config: RuntimeConfig): StorePersistence {
  switch (config.backend) {
    case StorageBackend.MEMORY:
      return new MemoryPersistence();
    case StorageBackend.DB:
      return new JsonFilePersistence(config.path);
    case StorageBackend.SQLITE:
      return new SqlitePersistence(config.path);
  }
}

class MemoryPersistence implements StorePersistence {
  private snapshot: StoreSnapshot | null = null;

  load(): StoreSnapshot | null {
    return this.snapshot ? cloneSnapshot(this.snapshot) : null;
  }

  save(snapshot: StoreSnapshot): void {
    this.snapshot = cloneSnapshot(snapshot);
  }
}

class JsonFilePersistence implements StorePersistence {
  constructor(private readonly path: string) {}

  load(): StoreSnapshot | null {
    try {
      const raw = readFileSync(this.path, "utf8");
      if (!raw.trim()) {
        return null;
      }
      return parseSnapshot(raw);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  save(snapshot: StoreSnapshot): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(snapshot), "utf8");
  }
}

class SqlitePersistence implements StorePersistence {
  private readonly db: DatabaseSync;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS store_snapshots (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)");
  }

  load(): StoreSnapshot | null {
    const row = this.db.prepare("SELECT state FROM store_snapshots WHERE id = 1").get() as { state: string } | undefined;
    return row ? parseSnapshot(row.state) : null;
  }

  save(snapshot: StoreSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO store_snapshots (id, state) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state"
      )
      .run(JSON.stringify(snapshot));
  }
}

function parseSnapshot(raw: string): StoreSnapshot {
  const parsed = JSON.parse(raw) as Partial<StoreSnapshot>;
  return {
    equipmentTypes: parsed.equipmentTypes ?? [],
    containers: parsed.containers ?? [],
    reservations: parsed.reservations ?? []
  };
}

function cloneSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  return parseSnapshot(JSON.stringify(snapshot));
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
