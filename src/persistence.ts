import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DomainError } from "./errors.js";
import type { AuditEvent, ContainerUnit, EquipmentType, LocalUser, Reservation } from "./types.js";

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
export const SQLITE_SCHEMA_VERSION = 3;

export interface StoreSnapshot {
  auditEvents: AuditEvent[];
  equipmentTypes: EquipmentType[];
  users: LocalUser[];
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
    this.applyMigrations();
  }

  load(): StoreSnapshot | null {
    const meta = this.db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as
      | { initialized: number }
      | undefined;
    if (!meta?.initialized) {
      return null;
    }

    const auditEvents = this.db
      .prepare(
        `SELECT
          id,
          actor,
          action,
          resource_type AS resourceType,
          resource_id AS resourceId,
          timestamp,
          request_context AS requestContext,
          outcome,
          error_message AS errorMessage
        FROM audit_events
        ORDER BY timestamp, id`
      )
      .all()
      .map((row) => ({
        ...(row as Omit<AuditEvent, "requestContext"> & { requestContext: string }),
        requestContext: JSON.parse((row as { requestContext: string }).requestContext) as AuditEvent["requestContext"]
      }));

    const equipmentTypes = this.db
      .prepare(
        `SELECT
          code,
          description,
          nominal_length AS nominalLength,
          max_payload_kg AS maxPayloadKg,
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM equipment_types
        ORDER BY code`
      )
      .all() as unknown as EquipmentType[];
    const users = this.db
      .prepare("SELECT id, issuer, subject, created_at AS createdAt FROM users ORDER BY created_at, id")
      .all() as unknown as LocalUser[];
    const containers = this.db
      .prepare(
        `SELECT
          id,
          container_number AS containerNumber,
          equipment_type AS equipmentType,
          status,
          current_depot AS currentDepot,
          booking_reference AS bookingReference,
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          last_moved_at AS lastMovedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
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
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          created_at AS createdAt,
          updated_at AS updatedAt
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
      auditEvents,
      equipmentTypes,
      users,
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
    const insertAuditEvent = this.db.prepare(
      `INSERT INTO audit_events (
        id,
        actor,
        action,
        resource_type,
        resource_id,
        timestamp,
        request_context,
        outcome,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertEquipmentType = this.db.prepare(
      `INSERT INTO equipment_types (
        code,
        description,
        nominal_length,
        max_payload_kg,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertUser = this.db.prepare(
      "INSERT INTO users (id, issuer, subject, created_at) VALUES (?, ?, ?, ?)"
    );
    const insertContainer = this.db.prepare(
      `INSERT INTO containers (
        id,
        container_number,
        equipment_type,
        status,
        current_depot,
        booking_reference,
        created_by_user_id,
        last_modified_by_user_id,
        last_moved_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertReservation = this.db.prepare(
      `INSERT INTO reservations (
        id,
        booking_reference,
        origin_depot,
        status,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertReservationContainer = this.db.prepare(
      "INSERT INTO reservation_containers (reservation_id, container_id, order_index) VALUES (?, ?, ?)"
    );

    this.db.exec("BEGIN");
    try {
      upsertMeta.run();
      this.db.exec(
        "DELETE FROM audit_events; DELETE FROM reservation_containers; DELETE FROM reservations; DELETE FROM containers; DELETE FROM users; DELETE FROM equipment_types; DELETE FROM store_snapshots;"
      );

      for (const auditEvent of snapshot.auditEvents) {
        insertAuditEvent.run(
          auditEvent.id,
          auditEvent.actor,
          auditEvent.action,
          auditEvent.resourceType,
          auditEvent.resourceId,
          auditEvent.timestamp,
          JSON.stringify(auditEvent.requestContext),
          auditEvent.outcome,
          auditEvent.errorMessage
        );
      }

      for (const equipmentType of snapshot.equipmentTypes) {
        insertEquipmentType.run(
          equipmentType.code,
          equipmentType.description,
          equipmentType.nominalLength,
          equipmentType.maxPayloadKg,
          equipmentType.createdByUserId,
          equipmentType.lastModifiedByUserId,
          equipmentType.createdAt,
          equipmentType.updatedAt
        );
      }

      for (const user of snapshot.users) {
        insertUser.run(user.id, user.issuer, user.subject, user.createdAt);
      }

      for (const container of snapshot.containers) {
        insertContainer.run(
          container.id,
          container.containerNumber,
          container.equipmentType,
          container.status,
          container.currentDepot,
          container.bookingReference,
          container.createdByUserId,
          container.lastModifiedByUserId,
          container.lastMovedAt,
          container.createdAt,
          container.updatedAt
        );
      }

      for (const reservation of snapshot.reservations) {
        insertReservation.run(
          reservation.id,
          reservation.bookingReference,
          reservation.originDepot,
          reservation.status,
          reservation.createdByUserId,
          reservation.lastModifiedByUserId,
          reservation.createdAt,
          reservation.updatedAt
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

  private applyMigrations(): void {
    const currentVersion = this.getSchemaVersion();
    if (currentVersion > SQLITE_SCHEMA_VERSION) {
      throw new DomainError(
        `sqlite schema version ${currentVersion} is newer than supported version ${SQLITE_SCHEMA_VERSION}`,
        500
      );
    }

    for (let version = currentVersion + 1; version <= SQLITE_SCHEMA_VERSION; version += 1) {
      this.runMigration(version);
      this.setSchemaVersion(version);
    }
  }

  private runMigration(version: number): void {
    switch (version) {
      case 1:
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
        return;
      case 2:
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            request_context TEXT NOT NULL,
            outcome TEXT NOT NULL,
            error_message TEXT
          );

          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            issuer TEXT NOT NULL,
            subject TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (issuer, subject)
          );
        `);
        return;
      case 3:
        this.ensureAuditMetadataColumns();
        this.backfillAuditMetadata();
        this.migrateLegacySnapshot();
        return;
      default:
        throw new DomainError(`unsupported sqlite migration ${version}`, 500);
    }
  }

  private getSchemaVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    return row.user_version;
  }

  private setSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${version}`);
  }

  private ensureAuditMetadataColumns(): void {
    this.ensureColumn("equipment_types", "created_by_user_id", "TEXT");
    this.ensureColumn("equipment_types", "last_modified_by_user_id", "TEXT");
    this.ensureColumn("equipment_types", "created_at", "TEXT");
    this.ensureColumn("equipment_types", "updated_at", "TEXT");
    this.ensureColumn("containers", "created_by_user_id", "TEXT");
    this.ensureColumn("containers", "last_modified_by_user_id", "TEXT");
    this.ensureColumn("containers", "updated_at", "TEXT");
    this.ensureColumn("reservations", "created_by_user_id", "TEXT");
    this.ensureColumn("reservations", "last_modified_by_user_id", "TEXT");
    this.ensureColumn("reservations", "updated_at", "TEXT");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private backfillAuditMetadata(): void {
    this.db.exec(`
      UPDATE equipment_types
      SET created_at = COALESCE(created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));

      UPDATE containers
      SET updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));

      UPDATE reservations
      SET updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);
  }
}

function parseSnapshot(raw: string): StoreSnapshot {
  const parsed = JSON.parse(raw) as Partial<StoreSnapshot>;
  const now = new Date().toISOString();
  return {
    auditEvents: parsed.auditEvents ?? [],
    equipmentTypes: (parsed.equipmentTypes ?? []).map((equipmentType) => ({
      ...equipmentType,
      createdByUserId: equipmentType.createdByUserId ?? null,
      lastModifiedByUserId: equipmentType.lastModifiedByUserId ?? null,
      createdAt: equipmentType.createdAt ?? now,
      updatedAt: equipmentType.updatedAt ?? equipmentType.createdAt ?? now
    })),
    users: parsed.users ?? [],
    containers: (parsed.containers ?? []).map((container) => ({
      ...container,
      createdByUserId: container.createdByUserId ?? null,
      lastModifiedByUserId: container.lastModifiedByUserId ?? null,
      createdAt: container.createdAt ?? now,
      updatedAt: container.updatedAt ?? container.createdAt ?? now
    })),
    reservations: (parsed.reservations ?? []).map((reservation) => ({
      ...reservation,
      createdByUserId: reservation.createdByUserId ?? null,
      lastModifiedByUserId: reservation.lastModifiedByUserId ?? null,
      createdAt: reservation.createdAt ?? now,
      updatedAt: reservation.updatedAt ?? reservation.createdAt ?? now
    }))
  };
}

function cloneSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  return parseSnapshot(JSON.stringify(snapshot));
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
