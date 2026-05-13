import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DomainError } from "../errors.js";
import { AuditOutcome, ContainerStatus, ReservationStatus, type AuditEvent, type ContainerUnit, type EquipmentType, type LocalUser, type Reservation } from "../types.js";

import { parseSnapshot } from "./snapshot.js";
import { SQLITE_SCHEMA_VERSION, type StorePersistence, type StoreSnapshot } from "./types.js";

const CONTAINER_STATUS_VALUES = sqlStringList(Object.values(ContainerStatus));
const RESERVATION_STATUS_VALUES = sqlStringList(Object.values(ReservationStatus));
const AUDIT_OUTCOME_VALUES = sqlStringList(Object.values(AuditOutcome));

export class SqlitePersistence implements StorePersistence {
  private readonly db: DatabaseSync;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
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
        "DELETE FROM audit_events; DELETE FROM reservation_containers; DELETE FROM reservations; DELETE FROM containers; DELETE FROM equipment_types; DELETE FROM users;"
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
      case 4:
        this.ensureUserProfileColumns();
        this.backfillUserProfileColumns();
        return;
      case 5:
        this.rebuildIntoNormalizedSchema();
        this.createIndexes();
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

  private ensureUserProfileColumns(): void {
    this.ensureColumn("users", "external_identity", "TEXT");
    this.ensureColumn("users", "display_name", "TEXT");
    this.ensureColumn("users", "email", "TEXT");
    this.ensureColumn("users", "status", "TEXT");
    this.ensureColumn("users", "updated_at", "TEXT");
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

  private backfillUserProfileColumns(): void {
    this.db.exec(`
      UPDATE users
      SET external_identity = COALESCE(external_identity, issuer || ':' || subject),
          status = COALESCE(status, 'ACTIVE'),
          updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);
  }

  private rebuildIntoNormalizedSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE users_next (
        id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
        external_identity TEXT NOT NULL UNIQUE CHECK (LENGTH(TRIM(external_identity)) > 0),
        issuer TEXT NOT NULL CHECK (LENGTH(TRIM(issuer)) > 0),
        subject TEXT NOT NULL CHECK (LENGTH(TRIM(subject)) > 0),
        display_name TEXT,
        email TEXT,
        status TEXT NOT NULL CHECK (LENGTH(TRIM(status)) > 0),
        created_at TEXT NOT NULL CHECK (LENGTH(TRIM(created_at)) > 0),
        updated_at TEXT NOT NULL CHECK (LENGTH(TRIM(updated_at)) > 0),
        UNIQUE (issuer, subject)
      );

      CREATE TABLE equipment_types_next (
        code TEXT PRIMARY KEY CHECK (LENGTH(TRIM(code)) > 0),
        description TEXT NOT NULL CHECK (LENGTH(TRIM(description)) > 0),
        nominal_length TEXT NOT NULL CHECK (LENGTH(TRIM(nominal_length)) > 0),
        max_payload_kg REAL NOT NULL CHECK (max_payload_kg > 0),
        created_by_user_id TEXT REFERENCES users_next(id) ON DELETE SET NULL,
        last_modified_by_user_id TEXT REFERENCES users_next(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL CHECK (LENGTH(TRIM(created_at)) > 0),
        updated_at TEXT NOT NULL CHECK (LENGTH(TRIM(updated_at)) > 0)
      );

      CREATE TABLE containers_next (
        id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
        container_number TEXT NOT NULL UNIQUE CHECK (LENGTH(TRIM(container_number)) > 0),
        equipment_type TEXT NOT NULL REFERENCES equipment_types_next(code) CHECK (LENGTH(TRIM(equipment_type)) > 0),
        status TEXT NOT NULL CHECK (status IN (${CONTAINER_STATUS_VALUES})),
        current_depot TEXT NOT NULL CHECK (LENGTH(TRIM(current_depot)) > 0),
        booking_reference TEXT CHECK (booking_reference IS NULL OR LENGTH(TRIM(booking_reference)) > 0),
        created_by_user_id TEXT REFERENCES users_next(id) ON DELETE SET NULL,
        last_modified_by_user_id TEXT REFERENCES users_next(id) ON DELETE SET NULL,
        last_moved_at TEXT NOT NULL CHECK (LENGTH(TRIM(last_moved_at)) > 0),
        created_at TEXT NOT NULL CHECK (LENGTH(TRIM(created_at)) > 0),
        updated_at TEXT NOT NULL CHECK (LENGTH(TRIM(updated_at)) > 0)
      );

      CREATE TABLE reservations_next (
        id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
        booking_reference TEXT NOT NULL UNIQUE CHECK (LENGTH(TRIM(booking_reference)) > 0),
        origin_depot TEXT NOT NULL CHECK (LENGTH(TRIM(origin_depot)) > 0),
        status TEXT NOT NULL CHECK (status IN (${RESERVATION_STATUS_VALUES})),
        created_by_user_id TEXT REFERENCES users_next(id) ON DELETE SET NULL,
        last_modified_by_user_id TEXT REFERENCES users_next(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL CHECK (LENGTH(TRIM(created_at)) > 0),
        updated_at TEXT NOT NULL CHECK (LENGTH(TRIM(updated_at)) > 0)
      );

      CREATE TABLE reservation_containers_next (
        reservation_id TEXT NOT NULL REFERENCES reservations_next(id) ON DELETE CASCADE,
        container_id TEXT NOT NULL REFERENCES containers_next(id) ON DELETE CASCADE,
        order_index INTEGER NOT NULL CHECK (order_index >= 0),
        PRIMARY KEY (reservation_id, container_id)
      );

      CREATE TABLE audit_events_next (
        id TEXT PRIMARY KEY CHECK (LENGTH(TRIM(id)) > 0),
        actor TEXT NOT NULL CHECK (LENGTH(TRIM(actor)) > 0),
        action TEXT NOT NULL CHECK (LENGTH(TRIM(action)) > 0),
        resource_type TEXT NOT NULL CHECK (LENGTH(TRIM(resource_type)) > 0),
        resource_id TEXT NOT NULL CHECK (LENGTH(TRIM(resource_id)) > 0),
        timestamp TEXT NOT NULL CHECK (LENGTH(TRIM(timestamp)) > 0),
        request_context TEXT NOT NULL CHECK (LENGTH(TRIM(request_context)) > 0),
        outcome TEXT NOT NULL CHECK (outcome IN (${AUDIT_OUTCOME_VALUES})),
        error_message TEXT
      );

      INSERT INTO users_next (id, external_identity, issuer, subject, display_name, email, status, created_at, updated_at)
      SELECT
        id,
        COALESCE(external_identity, issuer || ':' || subject),
        issuer,
        subject,
        display_name,
        email,
        COALESCE(status, 'ACTIVE'),
        created_at,
        COALESCE(updated_at, created_at)
      FROM users;

      INSERT INTO equipment_types_next (
        code,
        description,
        nominal_length,
        max_payload_kg,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        updated_at
      )
      SELECT
        code,
        description,
        nominal_length,
        max_payload_kg,
        created_by_user_id,
        last_modified_by_user_id,
        COALESCE(created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
        COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
      FROM equipment_types;

      INSERT INTO containers_next (
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
      )
      SELECT
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
        COALESCE(updated_at, created_at)
      FROM containers;

      INSERT INTO reservations_next (
        id,
        booking_reference,
        origin_depot,
        status,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        updated_at
      )
      SELECT
        id,
        booking_reference,
        origin_depot,
        status,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        COALESCE(updated_at, created_at)
      FROM reservations;

      INSERT INTO reservation_containers_next (reservation_id, container_id, order_index)
      SELECT reservation_id, container_id, order_index FROM reservation_containers;

      INSERT INTO audit_events_next (
        id,
        actor,
        action,
        resource_type,
        resource_id,
        timestamp,
        request_context,
        outcome,
        error_message
      )
      SELECT id, actor, action, resource_type, resource_id, timestamp, request_context, outcome, error_message
      FROM audit_events;

      DROP TABLE reservation_containers;
      DROP TABLE reservations;
      DROP TABLE containers;
      DROP TABLE equipment_types;
      DROP TABLE audit_events;
      DROP TABLE users;
      DROP TABLE IF EXISTS store_snapshots;

      ALTER TABLE users_next RENAME TO users;
      ALTER TABLE equipment_types_next RENAME TO equipment_types;
      ALTER TABLE containers_next RENAME TO containers;
      ALTER TABLE reservations_next RENAME TO reservations;
      ALTER TABLE reservation_containers_next RENAME TO reservation_containers;
      ALTER TABLE audit_events_next RENAME TO audit_events;

      PRAGMA foreign_keys = ON;
    `);
  }

  private createIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_containers_availability
        ON containers (equipment_type, current_depot, status);
      CREATE INDEX IF NOT EXISTS idx_containers_booking_reference
        ON containers (booking_reference);
      CREATE INDEX IF NOT EXISTS idx_reservations_origin_status
        ON reservations (origin_depot, status);
      CREATE INDEX IF NOT EXISTS idx_reservation_containers_container_id
        ON reservation_containers (container_id);
      CREATE INDEX IF NOT EXISTS idx_audit_events_resource_time
        ON audit_events (resource_type, resource_id, timestamp);
    `);
  }
}

function sqlStringList(values: string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}
