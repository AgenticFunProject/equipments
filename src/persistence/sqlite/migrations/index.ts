import type { DatabaseSync } from "node:sqlite";

import { DomainError } from "../../../errors.js";

import { initialSchemaMigration } from "./001-initial-schema.js";
import { auditAndUsersMigration } from "./002-audit-and-users.js";
import { auditMetadataMigration } from "./003-audit-metadata.js";
import { userProfilesMigration } from "./004-user-profiles.js";
import type { SqliteMigration } from "./types.js";

const SQLITE_MIGRATIONS: SqliteMigration[] = [
  initialSchemaMigration,
  auditAndUsersMigration,
  auditMetadataMigration,
  userProfilesMigration
];

export function runSqliteMigrations(
  db: DatabaseSync,
  options: { supportedVersion: number; persistLegacySnapshot(state: string): void }
): void {
  const currentVersion = getSchemaVersion(db);
  if (currentVersion > options.supportedVersion) {
    throw new DomainError(
      `sqlite schema version ${currentVersion} is newer than supported version ${options.supportedVersion}`,
      500
    );
  }

  for (const migration of SQLITE_MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    migration.apply({ db, persistLegacySnapshot: options.persistLegacySnapshot });
    setSchemaVersion(db, migration.version);
  }
}

function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}
