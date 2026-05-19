import type { SqliteMigrationContext } from "../../migration-context.js";
import { seedSqliteAuthorizationRulesTable } from "../../sqlite.js";

export async function up({ context }: { context: SqliteMigrationContext }): Promise<void> {
  seedSqliteAuthorizationRulesTable(context.db);
}
