import { Pool, type PoolClient } from "pg";

import { DomainError } from "../errors.js";
import { AuditOutcome, ContainerStatus, ReservationStatus, type AuditEvent, type ContainerUnit, type EquipmentType, type LocalUser, type Reservation } from "../types.js";

import {
  POSTGRES_SCHEMA_VERSION,
  type StorePersistence,
  type StoreSnapshot,
  type VersionedStorePersistence
} from "./types.js";
import { parseSnapshot } from "./snapshot.js";

interface PgPoolLike extends Pick<Pool, "end"> {
  connect(): Promise<PoolClient>;
}

const CONTAINER_STATUS_VALUES = sqlStringList(Object.values(ContainerStatus));
const RESERVATION_STATUS_VALUES = sqlStringList(Object.values(ReservationStatus));
const AUDIT_OUTCOME_VALUES = sqlStringList(Object.values(AuditOutcome));

export class PostgresPersistence implements StorePersistence, VersionedStorePersistence {
  private readonly pool: PgPoolLike;
  private setupPromise: Promise<void> | null = null;

  constructor(connectionString: string, createPool: (connectionString: string) => PgPoolLike = defaultCreatePool) {
    if (!connectionString) {
      throw new DomainError("postgres connection string is required", 500);
    }
    this.pool = createPool(connectionString);
  }

  async load(): Promise<StoreSnapshot | null> {
    return (await this.loadWithVersion()).snapshot;
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    const loaded = await this.loadWithVersion();
    const saved = await this.saveWithVersion(snapshot, loaded.version);
    if (!saved) {
      throw new DomainError("postgres persistence write conflict", 409);
    }
  }

  async loadWithVersion(): Promise<{ snapshot: StoreSnapshot | null; version: number }> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      const metaResult = await client.query<{ initialized: boolean; version: string }>(
        "SELECT initialized, version FROM store_meta WHERE id = 1"
      );
      const meta = metaResult.rows[0];
      if (!meta?.initialized) {
        return { snapshot: null, version: Number(meta?.version ?? 0) };
      }

      const auditEventsResult = await client.query<
        Omit<AuditEvent, "requestContext"> & { requestContext: AuditEvent["requestContext"] }
      >(
        `SELECT
          id,
          actor,
          action,
          resource_type AS "resourceType",
          resource_id AS "resourceId",
          timestamp,
          request_context AS "requestContext",
          outcome,
          error_message AS "errorMessage"
        FROM audit_events
        ORDER BY timestamp, id`
      );
      const equipmentTypesResult = await client.query<EquipmentType>(
        `SELECT
          code,
          description,
          nominal_length AS "nominalLength",
          max_payload_kg AS "maxPayloadKg",
          created_by_user_id AS "createdByUserId",
          last_modified_by_user_id AS "lastModifiedByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM equipment_types
        ORDER BY code`
      );
      const usersResult = await client.query<LocalUser>(
        `SELECT
          id,
          external_identity AS "externalIdentity",
          issuer,
          subject,
          display_name AS "displayName",
          email,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM users
        ORDER BY created_at, id`
      );
      const containersResult = await client.query<ContainerUnit>(
        `SELECT
          id,
          container_number AS "containerNumber",
          equipment_type AS "equipmentType",
          status,
          current_depot AS "currentDepot",
          booking_reference AS "bookingReference",
          created_by_user_id AS "createdByUserId",
          last_modified_by_user_id AS "lastModifiedByUserId",
          last_moved_at AS "lastMovedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM containers
        ORDER BY created_at, id`
      );
      const reservationsResult = await client.query<Omit<Reservation, "containers">>(
        `SELECT
          id,
          booking_reference AS "bookingReference",
          origin_depot AS "originDepot",
          status,
          created_by_user_id AS "createdByUserId",
          last_modified_by_user_id AS "lastModifiedByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM reservations
        ORDER BY created_at, id`
      );
      const reservationContainersResult = await client.query<{ reservationId: string; containerId: string }>(
        `SELECT
          reservation_id AS "reservationId",
          container_id AS "containerId"
        FROM reservation_containers
        ORDER BY reservation_id, order_index`
      );
      const containersByReservation = new Map<string, string[]>();

      for (const item of reservationContainersResult.rows) {
        const containerIds = containersByReservation.get(item.reservationId) ?? [];
        containerIds.push(item.containerId);
        containersByReservation.set(item.reservationId, containerIds);
      }

      return {
        version: Number(meta.version ?? 0),
        snapshot: {
          auditEvents: auditEventsResult.rows,
          equipmentTypes: equipmentTypesResult.rows,
          users: usersResult.rows,
          containers: containersResult.rows,
          reservations: reservationsResult.rows.map((reservation) => ({
            ...reservation,
            containers: containersByReservation.get(reservation.id) ?? []
          }))
        }
      };
    } finally {
      client.release();
    }
  }

  async saveWithVersion(snapshot: StoreSnapshot, expectedVersion: number): Promise<boolean> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentVersionResult = await client.query<{ version: string }>("SELECT version FROM store_meta WHERE id = 1 FOR UPDATE");
      const currentVersion = Number(currentVersionResult.rows[0]?.version ?? 0);
      if (currentVersion !== expectedVersion) {
        await client.query("ROLLBACK");
        return false;
      }

      await this.replaceRelationalSnapshot(client, snapshot);

      await client.query(
        `UPDATE store_meta
         SET initialized = TRUE,
             version = version + 1,
             updated_at = NOW()
         WHERE id = 1`
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureSchema(): Promise<void> {
    if (!this.setupPromise) {
      this.setupPromise = this.applyMigrations();
    }
    await this.setupPromise;
  }

  private async applyMigrations(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE TABLE IF NOT EXISTS store_meta (
          id integer PRIMARY KEY,
          schema_version integer NOT NULL DEFAULT 0,
          initialized boolean NOT NULL DEFAULT FALSE,
          version bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )`
      );
      await client.query(
        `INSERT INTO store_meta (id, schema_version, initialized, version)
         VALUES (1, 0, FALSE, 0)
         ON CONFLICT (id) DO NOTHING`
      );

      const versionResult = await client.query<{ schema_version: number }>(
        "SELECT schema_version FROM store_meta WHERE id = 1 FOR UPDATE"
      );
      const currentVersion = Number(versionResult.rows[0]?.schema_version ?? 0);
      if (currentVersion > POSTGRES_SCHEMA_VERSION) {
        throw new DomainError(
          `postgres schema version ${currentVersion} is newer than supported version ${POSTGRES_SCHEMA_VERSION}`,
          500
        );
      }

      for (let version = currentVersion + 1; version <= POSTGRES_SCHEMA_VERSION; version += 1) {
        await this.runMigration(client, version);
        await client.query("UPDATE store_meta SET schema_version = $1 WHERE id = 1", [version]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      this.setupPromise = null;
      throw error;
    } finally {
      client.release();
    }
  }

  private async runMigration(client: PoolClient, version: number): Promise<void> {
    switch (version) {
      case 1:
        await client.query(`
          CREATE TABLE IF NOT EXISTS store_snapshots (
            id integer PRIMARY KEY REFERENCES store_meta(id) ON DELETE CASCADE,
            snapshot jsonb NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_store_snapshots_id ON store_snapshots (id);
        `);
        return;
      case 2:
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id text PRIMARY KEY CHECK (id <> ''),
            external_identity text NOT NULL UNIQUE CHECK (external_identity <> ''),
            issuer text NOT NULL CHECK (issuer <> ''),
            subject text NOT NULL CHECK (subject <> ''),
            display_name text,
            email text,
            status text NOT NULL CHECK (status <> ''),
            created_at text NOT NULL CHECK (created_at <> ''),
            updated_at text NOT NULL CHECK (updated_at <> ''),
            UNIQUE (issuer, subject)
          );

          CREATE TABLE IF NOT EXISTS equipment_types (
            code text PRIMARY KEY CHECK (code <> ''),
            description text NOT NULL CHECK (description <> ''),
            nominal_length text NOT NULL CHECK (nominal_length <> ''),
            max_payload_kg double precision NOT NULL CHECK (max_payload_kg > 0),
            created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
            last_modified_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
            created_at text NOT NULL CHECK (created_at <> ''),
            updated_at text NOT NULL CHECK (updated_at <> '')
          );

          CREATE TABLE IF NOT EXISTS containers (
            id text PRIMARY KEY CHECK (id <> ''),
            container_number text NOT NULL UNIQUE CHECK (container_number <> ''),
            equipment_type text NOT NULL REFERENCES equipment_types(code) CHECK (equipment_type <> ''),
            status text NOT NULL CHECK (status IN (${CONTAINER_STATUS_VALUES})),
            current_depot text NOT NULL CHECK (current_depot <> ''),
            booking_reference text CHECK (booking_reference IS NULL OR booking_reference <> ''),
            created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
            last_modified_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
            last_moved_at text NOT NULL CHECK (last_moved_at <> ''),
            created_at text NOT NULL CHECK (created_at <> ''),
            updated_at text NOT NULL CHECK (updated_at <> '')
          );

          CREATE TABLE IF NOT EXISTS reservations (
            id text PRIMARY KEY CHECK (id <> ''),
            booking_reference text NOT NULL UNIQUE CHECK (booking_reference <> ''),
            origin_depot text NOT NULL CHECK (origin_depot <> ''),
            status text NOT NULL CHECK (status IN (${RESERVATION_STATUS_VALUES})),
            created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
            last_modified_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
            created_at text NOT NULL CHECK (created_at <> ''),
            updated_at text NOT NULL CHECK (updated_at <> '')
          );

          CREATE TABLE IF NOT EXISTS reservation_containers (
            reservation_id text NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
            container_id text NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
            order_index integer NOT NULL CHECK (order_index >= 0),
            PRIMARY KEY (reservation_id, container_id)
          );

          CREATE TABLE IF NOT EXISTS audit_events (
            id text PRIMARY KEY CHECK (id <> ''),
            actor text NOT NULL CHECK (actor <> ''),
            action text NOT NULL CHECK (action <> ''),
            resource_type text NOT NULL CHECK (resource_type <> ''),
            resource_id text NOT NULL CHECK (resource_id <> ''),
            timestamp text NOT NULL CHECK (timestamp <> ''),
            request_context jsonb NOT NULL,
            outcome text NOT NULL CHECK (outcome IN (${AUDIT_OUTCOME_VALUES})),
            error_message text
          );

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

        await this.migrateLegacySnapshot(client);
        return;
      default:
        throw new DomainError(`unsupported postgres migration ${version}`, 500);
    }
  }

  private async migrateLegacySnapshot(client: PoolClient): Promise<void> {
    const legacyResult = await client.query<{ initialized: boolean; snapshot: unknown }>(
      `SELECT meta.initialized, snapshots.snapshot
       FROM store_meta AS meta
       LEFT JOIN store_snapshots AS snapshots ON snapshots.id = meta.id
       WHERE meta.id = 1`
    );
    const legacy = legacyResult.rows[0];
    if (!legacy?.snapshot) {
      return;
    }

    await this.replaceRelationalSnapshot(client, parseSnapshot(JSON.stringify(legacy.snapshot)));
    if (legacy.initialized) {
      await client.query("UPDATE store_meta SET initialized = TRUE WHERE id = 1");
    }
  }

  private async replaceRelationalSnapshot(client: PoolClient, snapshot: StoreSnapshot): Promise<void> {
    await client.query("DELETE FROM audit_events");
    await client.query("DELETE FROM reservation_containers");
    await client.query("DELETE FROM reservations");
    await client.query("DELETE FROM containers");
    await client.query("DELETE FROM equipment_types");
    await client.query("DELETE FROM users");

    for (const user of snapshot.users) {
      await client.query(
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          user.externalIdentity,
          user.issuer,
          user.subject,
          user.displayName,
          user.email,
          user.status,
          user.createdAt,
          user.updatedAt
        ]
      );
    }

    for (const equipmentType of snapshot.equipmentTypes) {
      await client.query(
        `INSERT INTO equipment_types (
          code,
          description,
          nominal_length,
          max_payload_kg,
          created_by_user_id,
          last_modified_by_user_id,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          equipmentType.code,
          equipmentType.description,
          equipmentType.nominalLength,
          equipmentType.maxPayloadKg,
          equipmentType.createdByUserId,
          equipmentType.lastModifiedByUserId,
          equipmentType.createdAt,
          equipmentType.updatedAt
        ]
      );
    }

    for (const container of snapshot.containers) {
      await client.query(
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
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
        ]
      );
    }

    for (const reservation of snapshot.reservations) {
      await client.query(
        `INSERT INTO reservations (
          id,
          booking_reference,
          origin_depot,
          status,
          created_by_user_id,
          last_modified_by_user_id,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          reservation.id,
          reservation.bookingReference,
          reservation.originDepot,
          reservation.status,
          reservation.createdByUserId,
          reservation.lastModifiedByUserId,
          reservation.createdAt,
          reservation.updatedAt
        ]
      );

      for (const [index, containerId] of reservation.containers.entries()) {
        await client.query(
          `INSERT INTO reservation_containers (reservation_id, container_id, order_index)
           VALUES ($1, $2, $3)`,
          [reservation.id, containerId, index]
        );
      }
    }

    for (const auditEvent of snapshot.auditEvents) {
      await client.query(
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          auditEvent.id,
          auditEvent.actor,
          auditEvent.action,
          auditEvent.resourceType,
          auditEvent.resourceId,
          auditEvent.timestamp,
          JSON.stringify(auditEvent.requestContext),
          auditEvent.outcome,
          auditEvent.errorMessage
        ]
      );
    }
  }
}

function defaultCreatePool(connectionString: string): PgPoolLike {
  return new Pool({ connectionString });
}

function sqlStringList(values: string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}
