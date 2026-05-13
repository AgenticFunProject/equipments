import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Pool } from "pg";
import { Umzug } from "umzug";

import { DomainError } from "../../errors.js";

import { POSTGRES_MIGRATIONS, SQLITE_MIGRATIONS } from "../migration-catalog.js";
import type { PostgresMigrationContext, SqliteMigrationContext } from "../migration-context.js";
import {
  type PgPoolLike,
  assertPostgresSchemaReady,
  readPostgresSchemaVersion
} from "../postgres.js";
import {
  assertSqliteDatabasePathReady,
  assertSqliteSchemaReady,
  getSqliteSchemaVersion,
  setSqliteSchemaVersion
} from "../sqlite.js";
import { StorageBackend, type RuntimeConfig } from "../types.js";

export type MigrationAction = "up" | "status";

export async function runMigrations(config: RuntimeConfig, action: MigrationAction = "up"): Promise<{ executed: string[]; pending: string[] }> {
  switch (config.backend) {
    case StorageBackend.SQLITE:
      return runSqliteMigrations(config.path, action);
    case StorageBackend.POSTGRES:
      return runPostgresMigrations(config.connectionString ?? "", undefined, action);
    default:
      throw new DomainError(`migrations are not supported for ${config.backend} storage`, 400);
  }
}

export async function assertRuntimeSchemaReady(config: RuntimeConfig): Promise<void> {
  switch (config.backend) {
    case StorageBackend.MEMORY:
    case StorageBackend.DB:
      return;
    case StorageBackend.SQLITE: {
      assertSqliteDatabasePathReady(config.path);
      const db = new DatabaseSync(config.path);
      try {
        assertSqliteSchemaReady(db, config.path);
      } finally {
        db.close();
      }
      return;
    }
    case StorageBackend.POSTGRES: {
      const pool = createDefaultPool(config.connectionString ?? "");
      try {
        await assertPostgresSchemaReady(pool);
      } finally {
        await pool.end();
      }
    }
  }
}

export async function runSqliteMigrations(path: string, action: MigrationAction = "up"): Promise<{ executed: string[]; pending: string[] }> {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    const names = SQLITE_MIGRATIONS.map((migration) => migration.name);
    const umzug = new Umzug<SqliteMigrationContext>({
      context: { db },
      migrations: SQLITE_MIGRATIONS,
      storage: new SqliteVersionStorage(db, names),
      logger: undefined
    });
    if (action === "up") {
      await umzug.up();
    }
    return {
      executed: (await umzug.executed()).map((migration: { name: string }) => migration.name),
      pending: (await umzug.pending()).map((migration: { name: string }) => migration.name)
    };
  } finally {
    db.close();
  }
}

export async function runPostgresMigrations(
  connectionString: string,
  createPool: (connectionString: string) => PgPoolLike = createDefaultPool,
  action: MigrationAction = "up"
): Promise<{ executed: string[]; pending: string[] }> {
  if (!connectionString) {
    throw new DomainError("postgres connection string is required", 500);
  }
  const pool = createPool(connectionString);
  try {
    const names = POSTGRES_MIGRATIONS.map((migration) => migration.name);
    const migrationContext = await createPostgresMigrationContext(pool);
    const umzug = new Umzug<PostgresMigrationContext>({
      context: migrationContext.context,
      migrations: POSTGRES_MIGRATIONS,
      storage: new PostgresVersionStorage(pool, names),
      logger: undefined
    });
    try {
      if (action === "up") {
        await umzug.up();
      }
      return {
        executed: (await umzug.executed()).map((migration: { name: string }) => migration.name),
        pending: (await umzug.pending()).map((migration: { name: string }) => migration.name)
      };
    } finally {
      migrationContext.release();
    }
  } finally {
    await pool.end();
  }
}

class SqliteVersionStorage {
  constructor(
    private readonly db: DatabaseSync,
    private readonly migrationNames: string[]
  ) {}

  async executed(): Promise<string[]> {
    return this.migrationNames.slice(0, getSqliteSchemaVersion(this.db));
  }

  async logMigration({ name }: { name: string }): Promise<void> {
    setSqliteSchemaVersion(this.db, versionForMigration(name, this.migrationNames));
  }

  async unlogMigration({ name }: { name: string }): Promise<void> {
    setSqliteSchemaVersion(this.db, Math.max(0, versionForMigration(name, this.migrationNames) - 1));
  }
}

class PostgresVersionStorage {
  constructor(
    private readonly pool: PgPoolLike,
    private readonly migrationNames: string[]
  ) {}

  async executed(): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      const version = await readPostgresSchemaVersion(client);
      return this.migrationNames.slice(0, Math.max(0, version ?? 0));
    } finally {
      client.release();
    }
  }

  async logMigration({ name }: { name: string }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("UPDATE store_meta SET schema_version = $1 WHERE id = 1", [versionForMigration(name, this.migrationNames)]);
    } finally {
      client.release();
    }
  }

  async unlogMigration({ name }: { name: string }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("UPDATE store_meta SET schema_version = $1 WHERE id = 1", [Math.max(0, versionForMigration(name, this.migrationNames) - 1)]);
    } finally {
      client.release();
    }
  }
}

async function createPostgresMigrationContext(pool: PgPoolLike): Promise<{ context: PostgresMigrationContext; release: () => void }> {
  const client = await pool.connect();
  return {
    context: {
      client: wrapMigrationClient(client)
    },
    release: () => client.release()
  };
}

function wrapMigrationClient(client: PostgresMigrationContext["client"]): PostgresMigrationContext["client"] {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "release") {
        return () => undefined;
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

function createDefaultPool(connectionString: string): PgPoolLike {
  return new Pool({ connectionString });
}

function versionForMigration(name: string, names: string[]): number {
  const index = names.indexOf(name);
  if (index === -1) {
    throw new DomainError(`unknown migration ${name}`, 500);
  }
  return index + 1;
}
