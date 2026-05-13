import { addColumnIfMissing } from "./helpers.js";
import type { SqliteMigration } from "./types.js";

export const userProfilesMigration: SqliteMigration = {
  version: 4,
  apply: ({ db }) => {
    addColumnIfMissing(db, "users", "external_identity", "TEXT");
    addColumnIfMissing(db, "users", "display_name", "TEXT");
    addColumnIfMissing(db, "users", "email", "TEXT");
    addColumnIfMissing(db, "users", "status", "TEXT");
    addColumnIfMissing(db, "users", "updated_at", "TEXT");

    db.exec(`
      UPDATE users
      SET external_identity = COALESCE(external_identity, issuer || ':' || subject),
          status = COALESCE(status, 'ACTIVE'),
          updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);
  }
};
