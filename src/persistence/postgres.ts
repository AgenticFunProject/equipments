import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from "node:worker_threads";

import type { AuditEvent, AuditOutcome, ContainerStatus, ContainerUnit, EquipmentType, LocalUser, Reservation, ReservationStatus } from "../types.js";
import { AuditOutcome as AuditOutcomeValues, ContainerStatus as ContainerStatusValues, ReservationStatus as ReservationStatusValues } from "../types.js";
import { DomainError } from "../errors.js";

import { parseSnapshot } from "./snapshot.js";
import { POSTGRES_SCHEMA_VERSION } from "./types.js";
import type { StorePersistence, StoreSnapshot } from "./types.js";

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

interface PostgresWorkerRequest {
  id: number;
  command: "assert-ready" | "load" | "save";
  signal: SharedArrayBuffer;
  snapshot?: StoreSnapshot;
}

interface PostgresWorkerSuccess {
  id: number;
  ok: true;
  result?: StoreSnapshot | null;
}

interface PostgresWorkerFailure {
  id: number;
  ok: false;
  error: {
    message: string;
    statusCode?: number;
  };
}

type PostgresWorkerResponse = PostgresWorkerSuccess | PostgresWorkerFailure;

export const CONTAINER_STATUS_VALUES = joinSqlValues<ContainerStatus>(Object.values(ContainerStatusValues));
export const RESERVATION_STATUS_VALUES = joinSqlValues<ReservationStatus>(Object.values(ReservationStatusValues));
export const AUDIT_OUTCOME_VALUES = joinSqlValues<AuditOutcome>(Object.values(AuditOutcomeValues));

export async function readPostgresSchemaVersion(client: PgClientLike): Promise<number | null> {
  if (!(await hasPostgresTable(client, "store_meta"))) {
    return null;
  }
  const result = await client.query("SELECT schema_version FROM store_meta WHERE id = 1");
  const version = result.rows[0]?.schema_version;
  return typeof version === "number" ? version : typeof version === "string" ? Number(version) : null;
}

export async function assertPostgresSchemaReady(pool: PgPoolLike): Promise<void> {
  const client = await pool.connect();
  try {
    if (!(await hasPostgresTable(client, "store_meta"))) {
      throw new DomainError("postgres schema is not initialized; run npm run migrate first", 500);
    }

    const version = await readPostgresSchemaVersion(client);
    if (version !== POSTGRES_SCHEMA_VERSION) {
      throw new DomainError(
        `postgres schema version ${version ?? 0} does not match expected version ${POSTGRES_SCHEMA_VERSION}; run npm run migrate first`,
        500
      );
    }
  } finally {
    client.release();
  }
}

export async function migrateLegacyPostgresSnapshot(_client: PgClientLike): Promise<void> {
  // PostgreSQL runtime persistence is not wired into the service yet, so there is no
  // legacy snapshot data to backfill here. The hook remains so future relational
  // persistence work can migrate JSON snapshot state into the relational tables.
}

export async function loadPostgresSnapshot(client: PgClientLike): Promise<StoreSnapshot | null> {
  const meta = await client.query("SELECT initialized FROM store_meta WHERE id = 1");
  const initialized = Boolean(meta.rows[0]?.initialized);
  if (!initialized) {
    return null;
  }

  const auditEvents = (await client.query(
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
  )).rows as unknown as AuditEvent[];

  const equipmentTypes = (await client.query(
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
  )).rows as unknown as EquipmentType[];

  const users = (await client.query(
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
  )).rows as unknown as LocalUser[];

  const containers = (await client.query(
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
  )).rows as unknown as ContainerUnit[];

  const reservations = (await client.query(
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
  )).rows as unknown as Array<Omit<Reservation, "containers">>;

  const reservationContainers = (await client.query(
    `SELECT
      reservation_id AS "reservationId",
      container_id AS "containerId"
    FROM reservation_containers
    ORDER BY reservation_id, order_index`
  )).rows as unknown as Array<{ reservationId: string; containerId: string }>;

  const snapshotRow = (await client.query("SELECT snapshot FROM store_snapshots WHERE id = 1")).rows[0] as
    | { snapshot?: StoreSnapshot }
    | undefined;

  if (
    equipmentTypes.length === 0 &&
    users.length === 0 &&
    containers.length === 0 &&
    reservations.length === 0 &&
    auditEvents.length === 0 &&
    snapshotRow?.snapshot
  ) {
    return parseSnapshot(JSON.stringify(snapshotRow.snapshot));
  }

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

export async function writePostgresSnapshot(client: PgClientLike, snapshot: StoreSnapshot): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO store_meta (id, schema_version, initialized, version, updated_at)
       VALUES (1, $1, TRUE, 1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET schema_version = EXCLUDED.schema_version,
           initialized = TRUE,
           version = store_meta.version + 1,
           updated_at = NOW()`,
      [POSTGRES_SCHEMA_VERSION]
    );
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

    await client.query(
      `INSERT INTO store_snapshots (id, snapshot)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [JSON.stringify(snapshot)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export class PostgresPersistence implements StorePersistence {
  private readonly bridge: PostgresWorkerBridge;

  constructor(connectionString: string) {
    if (!connectionString.trim()) {
      throw new DomainError("postgres connection string is required", 500);
    }

    this.bridge = new PostgresWorkerBridge(connectionString);
    try {
      this.bridge.call({ command: "assert-ready" });
    } catch (error) {
      this.bridge.dispose();
      throw error;
    }
  }

  load(): StoreSnapshot | null {
    return this.bridge.call({ command: "load" }) ?? null;
  }

  save(snapshot: StoreSnapshot): void {
    this.bridge.call({ command: "save", snapshot });
  }
}

async function hasPostgresTable(client: PgClientLike, tableName: string): Promise<boolean> {
  const result = await client.query(`SELECT to_regclass('public.${tableName}') AS table_name`);
  return Boolean(result.rows[0]?.table_name);
}

function joinSqlValues<T extends string>(values: T[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

class PostgresWorkerBridge {
  private readonly worker: Worker;
  private readonly responsePort: MessagePort;
  private nextId = 1;

  constructor(connectionString: string) {
    const channel = new MessageChannel();
    this.responsePort = channel.port1;
    this.responsePort.unref();

    const workerUrl = new URL(
      import.meta.url.endsWith(".ts") ? "./postgres-worker.ts" : "./postgres-worker.js",
      import.meta.url
    );

    this.worker = new Worker(workerUrl, {
      workerData: {
        connectionString,
        responsePort: channel.port2
      },
      transferList: [channel.port2],
      execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : []
    });
    this.worker.unref();
  }

  call({ command, snapshot }: { command: PostgresWorkerRequest["command"]; snapshot?: StoreSnapshot }): StoreSnapshot | null | void {
    const id = this.nextId;
    this.nextId += 1;
    const signal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const waitState = new Int32Array(signal);

    this.worker.postMessage({ id, command, signal, snapshot } satisfies PostgresWorkerRequest);
    const status = Atomics.wait(waitState, 0, 0, 120000);

    if (status === "timed-out") {
      throw new DomainError(`postgres persistence ${command} timed out`, 500);
    }

    const message = receiveMessageOnPort(this.responsePort)?.message as PostgresWorkerResponse | undefined;
    if (!message || message.id !== id) {
      throw new DomainError(`postgres persistence ${command} returned an invalid worker response`, 500);
    }
    if (!message.ok) {
      throw new DomainError(message.error.message, message.error.statusCode ?? 500);
    }

    return message.result;
  }

  dispose(): void {
    void this.worker.terminate();
    this.responsePort.close();
  }
}
