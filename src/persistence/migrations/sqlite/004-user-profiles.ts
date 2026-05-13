import type { SqliteMigrationContext } from "../../migration-context.js";
import { backfillSqliteUserProfileColumns, ensureSqliteUserProfileColumns } from "../../sqlite.js";

export async function up({ context }: { context: SqliteMigrationContext }): Promise<void> {
  ensureSqliteUserProfileColumns(context.db);
  backfillSqliteUserProfileColumns(context.db);
}
