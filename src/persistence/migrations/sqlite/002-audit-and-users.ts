import type { SqliteMigrationContext } from "../../migration-context.js";

export async function up({ context }: { context: SqliteMigrationContext }): Promise<void> {
  context.db.exec(`
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
}
