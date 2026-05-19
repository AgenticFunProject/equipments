import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createSeedAuthorizationRules } from "../authorization-rules.js";
import { DomainError } from "../errors.js";
import type { AuditEvent, AuthorizationRule, ContainerUnit, EquipmentType, LocalUser, Reservation } from "../types.js";

import { parseSnapshot } from "./snapshot.js";
import { SQLITE_SCHEMA_VERSION, type StorePersistence, type StoreSnapshot } from "./types.js";

export class SqlitePersistence implements StorePersistence {
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
    const authorizationRules = readSqliteAuthorizationRules(this.db);

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
      .prepare(
        `SELECT
          id,
          COALESCE(external_identity, issuer || ':' || subject) AS externalIdentity,
          issuer,
          subject,
          display_name AS displayName,
          email,
          COALESCE(status, 'ACTIVE') AS status,
          created_at AS createdAt,
          COALESCE(updated_at, created_at) AS updatedAt
        FROM users
        ORDER BY created_at, id`
      )
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
      authorizationRules,
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
    writeSqliteSnapshot(this.db, snapshot);
  }

  private applyMigrations(): void {
    const currentVersion = getSqliteSchemaVersion(this.db);
    if (currentVersion > SQLITE_SCHEMA_VERSION) {
      throw new DomainError(
        `sqlite schema version ${currentVersion} is newer than supported version ${SQLITE_SCHEMA_VERSION}`,
        500
      );
    }

    for (let version = currentVersion + 1; version <= SQLITE_SCHEMA_VERSION; version += 1) {
      this.runMigration(version);
      setSqliteSchemaVersion(this.db, version);
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
        ensureSqliteAuditMetadataColumns(this.db);
        backfillSqliteAuditMetadata(this.db);
        migrateLegacySqliteSnapshot(this.db);
        return;
      case 4:
        ensureSqliteUserProfileColumns(this.db);
        backfillSqliteUserProfileColumns(this.db);
        return;
      case 5:
        ensureSqliteAuthorizationRulesTable(this.db);
        seedSqliteAuthorizationRulesTable(this.db);
        return;
      default:
        throw new DomainError(`unsupported sqlite migration ${version}`, 500);
    }
  }
}

export function assertSqliteDatabasePathReady(path: string): void {
  if (!path.trim()) {
    throw new DomainError("sqlite database path is required", 500);
  }
}

export function getSqliteSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

export function setSqliteSchemaVersion(db: DatabaseSync, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

export function assertSqliteSchemaReady(db: DatabaseSync, path: string): void {
  const currentVersion = getSqliteSchemaVersion(db);
  if (currentVersion === 0) {
    throw new DomainError(`sqlite schema is not initialized for ${path}; run npm run migrate first`, 500);
  }
  if (currentVersion > SQLITE_SCHEMA_VERSION) {
    throw new DomainError(
      `sqlite schema version ${currentVersion} is newer than supported version ${SQLITE_SCHEMA_VERSION}`,
      500
    );
  }
  if (currentVersion !== SQLITE_SCHEMA_VERSION) {
    throw new DomainError(
      `sqlite schema version ${currentVersion} does not match expected version ${SQLITE_SCHEMA_VERSION}; run npm run migrate first`,
      500
    );
  }
}

export function migrateLegacySqliteSnapshot(db: DatabaseSync): void {
  const meta = db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as
    | { initialized: number }
    | undefined;
  if (meta?.initialized) {
    return;
  }

  const legacy = db.prepare("SELECT state FROM store_snapshots WHERE id = 1").get() as
    | { state: string }
    | undefined;
  if (!legacy) {
    return;
  }

  writeSqliteSnapshot(db, parseSnapshot(legacy.state));
}

export function ensureSqliteAuditMetadataColumns(db: DatabaseSync): void {
  ensureSqliteColumn(db, "equipment_types", "created_by_user_id", "TEXT");
  ensureSqliteColumn(db, "equipment_types", "last_modified_by_user_id", "TEXT");
  ensureSqliteColumn(db, "equipment_types", "created_at", "TEXT");
  ensureSqliteColumn(db, "equipment_types", "updated_at", "TEXT");
  ensureSqliteColumn(db, "containers", "created_by_user_id", "TEXT");
  ensureSqliteColumn(db, "containers", "last_modified_by_user_id", "TEXT");
  ensureSqliteColumn(db, "containers", "updated_at", "TEXT");
  ensureSqliteColumn(db, "reservations", "created_by_user_id", "TEXT");
  ensureSqliteColumn(db, "reservations", "last_modified_by_user_id", "TEXT");
  ensureSqliteColumn(db, "reservations", "updated_at", "TEXT");
}

export function backfillSqliteAuditMetadata(db: DatabaseSync): void {
  db.exec(`
    UPDATE equipment_types
    SET created_at = COALESCE(created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));

    UPDATE containers
    SET updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));

    UPDATE reservations
    SET updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));
  `);
}

export function ensureSqliteUserProfileColumns(db: DatabaseSync): void {
  ensureSqliteColumn(db, "users", "external_identity", "TEXT");
  ensureSqliteColumn(db, "users", "display_name", "TEXT");
  ensureSqliteColumn(db, "users", "email", "TEXT");
  ensureSqliteColumn(db, "users", "status", "TEXT");
  ensureSqliteColumn(db, "users", "updated_at", "TEXT");
}

export function backfillSqliteUserProfileColumns(db: DatabaseSync): void {
  db.exec(`
    UPDATE users
    SET external_identity = COALESCE(external_identity, issuer || ':' || subject),
        status = COALESCE(status, 'ACTIVE'),
        updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));
  `);
}

export function ensureSqliteAuthorizationRulesTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorization_rules (
      route_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      path_pattern TEXT NOT NULL,
      controller TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      required_scope TEXT,
      admin_accepted INTEGER NOT NULL,
      is_public INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (method, path_pattern)
    );
  `);
}

export function seedSqliteAuthorizationRulesTable(db: DatabaseSync): void {
  ensureSqliteAuthorizationRulesTable(db);

  const insertAuthorizationRule = db.prepare(
    `INSERT OR IGNORE INTO authorization_rules (
      route_key,
      method,
      path_pattern,
      controller,
      action,
      resource_type,
      required_scope,
      admin_accepted,
      is_public,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const rule of createSeedAuthorizationRules()) {
    insertAuthorizationRule.run(
      rule.routeKey,
      rule.method,
      rule.pathPattern,
      rule.controller,
      rule.action,
      rule.resourceType,
      rule.requiredScope,
      rule.adminAccepted ? 1 : 0,
      rule.public ? 1 : 0,
      rule.createdAt,
      rule.updatedAt
    );
  }
}

function writeSqliteSnapshot(db: DatabaseSync, snapshot: StoreSnapshot): void {
  ensureSqliteAuthorizationRulesTable(db);

  const upsertMeta = db.prepare(
    "INSERT INTO store_meta (id, initialized) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET initialized = excluded.initialized"
  );
  const insertAuthorizationRule = db.prepare(
    `INSERT INTO authorization_rules (
      route_key,
      method,
      path_pattern,
      controller,
      action,
      resource_type,
      required_scope,
      admin_accepted,
      is_public,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAuditEvent = db.prepare(
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
  const insertEquipmentType = db.prepare(
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
  const insertUser = db.prepare(
    `INSERT INTO users (
      id,
      external_identity,
      issuer,
      subject,
      display_name,
      email,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertContainer = db.prepare(
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
  const insertReservation = db.prepare(
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
  const insertReservationContainer = db.prepare(
    "INSERT INTO reservation_containers (reservation_id, container_id, order_index) VALUES (?, ?, ?)"
  );

  db.exec("BEGIN");
  try {
    upsertMeta.run();
    db.exec(
      "DELETE FROM audit_events; DELETE FROM authorization_rules; DELETE FROM reservation_containers; DELETE FROM reservations; DELETE FROM containers; DELETE FROM users; DELETE FROM equipment_types; DELETE FROM store_snapshots;"
    );

    for (const rule of snapshot.authorizationRules) {
      insertAuthorizationRule.run(
        rule.routeKey,
        rule.method,
        rule.pathPattern,
        rule.controller,
        rule.action,
        rule.resourceType,
        rule.requiredScope,
        rule.adminAccepted ? 1 : 0,
        rule.public ? 1 : 0,
        rule.createdAt,
        rule.updatedAt
      );
    }

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
      insertUser.run(
        user.id,
        user.externalIdentity,
        user.issuer,
        user.subject,
        user.displayName,
        user.email,
        user.status,
        user.createdAt,
        user.updatedAt
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

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readSqliteAuthorizationRules(db: DatabaseSync): AuthorizationRule[] {
  const rows = db
    .prepare(
      `SELECT
        route_key AS routeKey,
        method,
        path_pattern AS pathPattern,
        controller,
        action,
        resource_type AS resourceType,
        required_scope AS requiredScope,
        admin_accepted AS adminAccepted,
        is_public AS public,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM authorization_rules
      ORDER BY route_key`
    )
    .all() as unknown as Array<Omit<AuthorizationRule, "adminAccepted" | "public"> & { adminAccepted: number; public: number }>;

  if (!rows.length) {
    return createSeedAuthorizationRules();
  }

  return rows.map((row) => ({
    ...row,
    adminAccepted: Boolean(row.adminAccepted),
    public: Boolean(row.public)
  }));
}

function ensureSqliteColumn(db: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
