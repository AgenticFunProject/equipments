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
export const STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV = "STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT";

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
  sqliteEmptyOnFirstBoot?: boolean;
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
    return { backend, path: "", sqliteEmptyOnFirstBoot: false };
  }

  if (backend === StorageBackend.DB) {
    const path = env[STORAGE_DB_PATH_ENV]?.trim() ?? "";
    if (!path) {
      throw new DomainError(`${STORAGE_DB_PATH_ENV} is required when ${STORAGE_BACKEND_ENV}=db`);
    }
    return { backend, path, sqliteEmptyOnFirstBoot: false };
  }

  const path = env[STORAGE_SQLITE_PATH_ENV]?.trim() || env[STORAGE_DB_PATH_ENV]?.trim() || "";
  if (!path) {
    throw new DomainError(
      `${STORAGE_SQLITE_PATH_ENV} or ${STORAGE_DB_PATH_ENV} is required when ${STORAGE_BACKEND_ENV}=sqlite`
    );
  }

  return {
    backend,
    path,
    sqliteEmptyOnFirstBoot: parseBooleanFlag(env[STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV])
  };
}

function parseBooleanFlag(raw: string | undefined): boolean {
  switch (raw?.trim().toLowerCase()) {
    case undefined:
    case "":
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      throw new DomainError(`unsupported boolean flag value ${JSON.stringify(raw)}`);
  }
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS equipment_types (
        code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        nominal_length TEXT NOT NULL,
        max_payload_kg REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        container_number TEXT NOT NULL UNIQUE,
        equipment_type TEXT NOT NULL,
        status TEXT NOT NULL,
        current_depot TEXT NOT NULL,
        booking_reference TEXT,
        last_moved_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (equipment_type) REFERENCES equipment_types(code)
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        booking_reference TEXT NOT NULL UNIQUE,
        origin_depot TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservation_containers (
        reservation_id TEXT NOT NULL,
        container_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        PRIMARY KEY (reservation_id, container_id),
        FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
        FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS store_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL
      );
    `);
    this.migrateLegacySnapshot();
  }

  load(): StoreSnapshot | null {
    const meta = this.db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as
      | { initialized: number }
      | undefined;
    if (!meta?.initialized) {
      return null;
    }

    const equipmentTypes = this.db
      .prepare(
        "SELECT code, description, nominal_length AS nominalLength, max_payload_kg AS maxPayloadKg FROM equipment_types ORDER BY code"
      )
      .all() as unknown as EquipmentType[];
    const containers = this.db
      .prepare(
        `SELECT
          id,
          container_number AS containerNumber,
          equipment_type AS equipmentType,
          status,
          current_depot AS currentDepot,
          booking_reference AS bookingReference,
          last_moved_at AS lastMovedAt,
          created_at AS createdAt
        FROM containers
        ORDER BY created_at, id`
      )
      .all() as unknown as ContainerUnit[];
    const reservations = this.db
      .prepare(
        `SELECT
          id,
          booking_reference AS bookingReference,
          origin_depot AS originDepot,
          status,
          created_at AS createdAt
        FROM reservations
        ORDER BY created_at, id`
      )
      .all() as unknown as Array<Omit<Reservation, "containers">>;
    const reservationContainers = this.db
      .prepare(
        `SELECT reservation_id AS reservationId, container_id AS containerId
        FROM reservation_containers
        ORDER BY reservation_id, order_index`
      )
      .all() as unknown as Array<{ reservationId: string; containerId: string }>;
    const containersByReservation = new Map<string, string[]>();

    for (const item of reservationContainers) {
      const containerIds = containersByReservation.get(item.reservationId) ?? [];
      containerIds.push(item.containerId);
      containersByReservation.set(item.reservationId, containerIds);
    }

    return {
      equipmentTypes,
      containers,
      reservations: reservations.map((reservation) => ({
        ...reservation,
        containers: containersByReservation.get(reservation.id) ?? []
      }))
    };
  }

  save(snapshot: StoreSnapshot): void {
    const upsertMeta = this.db.prepare(
      "INSERT INTO store_meta (id, initialized) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET initialized = excluded.initialized"
    );
    const insertEquipmentType = this.db.prepare(
      "INSERT INTO equipment_types (code, description, nominal_length, max_payload_kg) VALUES (?, ?, ?, ?)"
    );
    const insertContainer = this.db.prepare(
      `INSERT INTO containers (
        id,
        container_number,
        equipment_type,
        status,
        current_depot,
        booking_reference,
        last_moved_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertReservation = this.db.prepare(
      "INSERT INTO reservations (id, booking_reference, origin_depot, status, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertReservationContainer = this.db.prepare(
      "INSERT INTO reservation_containers (reservation_id, container_id, order_index) VALUES (?, ?, ?)"
    );

    this.db.exec("BEGIN");
    try {
      upsertMeta.run();
      this.db.exec(
        "DELETE FROM reservation_containers; DELETE FROM reservations; DELETE FROM containers; DELETE FROM equipment_types; DELETE FROM store_snapshots;"
      );

      for (const equipmentType of snapshot.equipmentTypes) {
        insertEquipmentType.run(
          equipmentType.code,
          equipmentType.description,
          equipmentType.nominalLength,
          equipmentType.maxPayloadKg
        );
      }

      for (const container of snapshot.containers) {
        insertContainer.run(
          container.id,
          container.containerNumber,
          container.equipmentType,
          container.status,
          container.currentDepot,
          container.bookingReference,
          container.lastMovedAt,
          container.createdAt
        );
      }

      for (const reservation of snapshot.reservations) {
        insertReservation.run(
          reservation.id,
          reservation.bookingReference,
          reservation.originDepot,
          reservation.status,
          reservation.createdAt
        );

        reservation.containers.forEach((containerId, index) => {
          insertReservationContainer.run(reservation.id, containerId, index);
        });
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrateLegacySnapshot(): void {
    const meta = this.db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as
      | { initialized: number }
      | undefined;
    if (meta?.initialized) {
      return;
    }

    const legacy = this.db.prepare("SELECT state FROM store_snapshots WHERE id = 1").get() as
      | { state: string }
      | undefined;
    if (!legacy) {
      return;
    }

    this.save(parseSnapshot(legacy.state));
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
