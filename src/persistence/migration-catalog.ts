import { up as postgres001 } from "./migrations/postgres/001-store-meta-and-snapshots.js";
import { up as postgres002 } from "./migrations/postgres/002-relational-state.js";
import { up as sqlite001 } from "./migrations/sqlite/001-initial-schema.js";
import { up as sqlite002 } from "./migrations/sqlite/002-audit-and-users.js";
import { up as sqlite003 } from "./migrations/sqlite/003-audit-metadata-and-legacy-snapshot.js";
import { up as sqlite004 } from "./migrations/sqlite/004-user-profiles.js";

export const SQLITE_MIGRATIONS = [
  { name: "001-initial-schema", up: sqlite001 },
  { name: "002-audit-and-users", up: sqlite002 },
  { name: "003-audit-metadata-and-legacy-snapshot", up: sqlite003 },
  { name: "004-user-profiles", up: sqlite004 }
];

export const POSTGRES_MIGRATIONS = [
  { name: "001-store-meta-and-snapshots", up: postgres001 },
  { name: "002-relational-state", up: postgres002 }
];
