import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

interface NamedMigration<Context> {
  name: string;
  up: (params: { context: Context }) => Promise<void> | void;
}

interface VersionStorage {
  executed(): Promise<string[]>;
  logMigration(params: { name: string }): Promise<void>;
  unlogMigration(params: { name: string }): Promise<void>;
}

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
      const pool = await createDefaultPool(config.connectionString ?? "");
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
    return await runMigrationPlan({ db }, SQLITE_MIGRATIONS, new SqliteVersionStorage(db, SQLITE_MIGRATIONS.map((migration) => migration.name)), action);
  } finally {
    db.close();
  }
}

export async function runPostgresMigrations(
  connectionString: string,
  createPool?: (connectionString: string) => PgPoolLike | Promise<PgPoolLike>,
  action: MigrationAction = "up"
): Promise<{ executed: string[]; pending: string[] }> {
  if (!connectionString) {
    throw new DomainError("postgres connection string is required", 500);
  }
  const pool = createPool ? await createPool(connectionString) : await createDefaultPool(connectionString);
  try {
    const migrationContext = await createPostgresMigrationContext(pool);
    try {
      return await runMigrationPlan(
        migrationContext.context,
        POSTGRES_MIGRATIONS,
        new PostgresVersionStorage(pool, POSTGRES_MIGRATIONS.map((migration) => migration.name)),
        action
      );
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

async function createDefaultPool(connectionString: string): Promise<PgPoolLike> {
  const { Pool } = await import("pg");
  return new Pool({ connectionString });
}

async function runMigrationPlan<Context>(
  context: Context,
  migrations: NamedMigration<Context>[],
  storage: VersionStorage,
  action: MigrationAction
): Promise<{ executed: string[]; pending: string[] }> {
  const executedNames = new Set(await storage.executed());

  if (action === "up") {
    for (const migration of migrations) {
      if (executedNames.has(migration.name)) {
        continue;
      }

      await migration.up({ context });
      await storage.logMigration({ name: migration.name });
      executedNames.add(migration.name);
    }
  }

  const executed = await storage.executed();
  const executedSet = new Set(executed);
  return {
    executed,
    pending: migrations.filter((migration) => !executedSet.has(migration.name)).map((migration) => migration.name)
  };
}

function versionForMigration(name: string, names: string[]): number {
  const index = names.indexOf(name);
  if (index === -1) {
    throw new DomainError(`unknown migration ${name}`, 500);
  }
  return index + 1;
}
