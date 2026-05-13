import type { AuditOutcome, ContainerStatus, ReservationStatus } from "../types.js";
import { AuditOutcome as AuditOutcomeValues, ContainerStatus as ContainerStatusValues, ReservationStatus as ReservationStatusValues } from "../types.js";
import { DomainError } from "../errors.js";

import { POSTGRES_SCHEMA_VERSION } from "./types.js";

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

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

async function hasPostgresTable(client: PgClientLike, tableName: string): Promise<boolean> {
  const result = await client.query(`SELECT to_regclass('public.${tableName}') AS table_name`);
  return Boolean(result.rows[0]?.table_name);
}

function joinSqlValues<T extends string>(values: T[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}
