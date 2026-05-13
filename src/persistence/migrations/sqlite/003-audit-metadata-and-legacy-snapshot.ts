import type { SqliteMigrationContext } from "../../migration-context.js";
import {
  backfillSqliteAuditMetadata,
  ensureSqliteAuditMetadataColumns,
  migrateLegacySqliteSnapshot
} from "../../sqlite.js";

export async function up({ context }: { context: SqliteMigrationContext }): Promise<void> {
  ensureSqliteAuditMetadataColumns(context.db);
  backfillSqliteAuditMetadata(context.db);
  migrateLegacySqliteSnapshot(context.db);
}
