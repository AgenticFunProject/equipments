import type { DatabaseSync } from "node:sqlite";

import type { PgClientLike } from "./postgres.js";

export interface SqliteMigrationContext {
  db: DatabaseSync;
}

export interface PostgresMigrationContext {
  client: PgClientLike;
}
