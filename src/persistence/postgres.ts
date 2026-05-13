import { Pool, type PoolClient } from "pg";

import { DomainError } from "../errors.js";

import { parseSnapshot } from "./snapshot.js";
import {
  POSTGRES_SCHEMA_VERSION,
  type StorePersistence,
  type StoreSnapshot,
  type VersionedStorePersistence
} from "./types.js";

interface PgPoolLike extends Pick<Pool, "connect" | "end"> {}

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
      const metaResult = await client.query<{ version: string }>("SELECT version FROM store_meta WHERE id = 1");
      const snapshotResult = await client.query<{ snapshot: unknown }>("SELECT snapshot FROM store_snapshots WHERE id = 1");
      return {
        version: Number(metaResult.rows[0]?.version ?? 0),
        snapshot: snapshotResult.rows[0] ? parseSnapshot(JSON.stringify(snapshotResult.rows[0].snapshot)) : null
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

      await client.query(
        `INSERT INTO store_snapshots (id, snapshot)
         VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
        [JSON.stringify(snapshot)]
      );
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
          schema_version integer NOT NULL,
          initialized boolean NOT NULL DEFAULT FALSE,
          version bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )`
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS store_snapshots (
          id integer PRIMARY KEY REFERENCES store_meta(id) ON DELETE CASCADE,
          snapshot jsonb NOT NULL
        )`
      );
      await client.query(
        `INSERT INTO store_meta (id, schema_version, initialized, version)
         VALUES (1, $1, FALSE, 0)
         ON CONFLICT (id) DO NOTHING`,
        [POSTGRES_SCHEMA_VERSION]
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

      for (let version = currentVersion; version < POSTGRES_SCHEMA_VERSION; version += 1) {
        switch (version) {
          default:
            throw new DomainError(`unsupported postgres migration ${version}`, 500);
        }
      }

      await client.query("UPDATE store_meta SET schema_version = $1 WHERE id = 1", [POSTGRES_SCHEMA_VERSION]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      this.setupPromise = null;
      throw error;
    } finally {
      client.release();
    }
  }
}

function defaultCreatePool(connectionString: string): PgPoolLike {
  return new Pool({ connectionString });
}
