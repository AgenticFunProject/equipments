import type { DatabaseSync } from "node:sqlite";

export interface SqliteMigrationContext {
  db: DatabaseSync;
  persistLegacySnapshot(state: string): void;
}

export interface SqliteMigration {
  version: number;
  apply(context: SqliteMigrationContext): void;
}
