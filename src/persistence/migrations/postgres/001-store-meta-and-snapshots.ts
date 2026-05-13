import type { PostgresMigrationContext } from "../../migration-context.js";

export async function up({ context }: { context: PostgresMigrationContext }): Promise<void> {
  await context.client.query(`
    CREATE TABLE IF NOT EXISTS store_meta (
      id integer PRIMARY KEY,
      schema_version integer NOT NULL DEFAULT 0,
      initialized boolean NOT NULL DEFAULT FALSE,
      version bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await context.client.query(
    `INSERT INTO store_meta (id, schema_version, initialized, version)
     VALUES (1, 0, FALSE, 0)
     ON CONFLICT (id) DO NOTHING`
  );
  await context.client.query(`
    CREATE TABLE IF NOT EXISTS store_snapshots (
      id integer PRIMARY KEY REFERENCES store_meta(id) ON DELETE CASCADE,
      snapshot jsonb NOT NULL
    )
  `);
  await context.client.query(`CREATE INDEX IF NOT EXISTS idx_store_snapshots_id ON store_snapshots (id)`);
}
