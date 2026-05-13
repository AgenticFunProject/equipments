import { addColumnIfMissing } from "./helpers.js";
import type { SqliteMigration } from "./types.js";

export const auditMetadataMigration: SqliteMigration = {
  version: 3,
  apply: ({ db, persistLegacySnapshot }) => {
    addColumnIfMissing(db, "equipment_types", "created_by_user_id", "TEXT");
    addColumnIfMissing(db, "equipment_types", "last_modified_by_user_id", "TEXT");
    addColumnIfMissing(db, "equipment_types", "created_at", "TEXT");
    addColumnIfMissing(db, "equipment_types", "updated_at", "TEXT");
    addColumnIfMissing(db, "containers", "created_by_user_id", "TEXT");
    addColumnIfMissing(db, "containers", "last_modified_by_user_id", "TEXT");
    addColumnIfMissing(db, "containers", "updated_at", "TEXT");
    addColumnIfMissing(db, "reservations", "created_by_user_id", "TEXT");
    addColumnIfMissing(db, "reservations", "last_modified_by_user_id", "TEXT");
    addColumnIfMissing(db, "reservations", "updated_at", "TEXT");

    db.exec(`
      UPDATE equipment_types
      SET created_at = COALESCE(created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));

      UPDATE containers
      SET updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));

      UPDATE reservations
      SET updated_at = COALESCE(updated_at, created_at, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);

    const meta = db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as
      | { initialized: number }
      | undefined;
    if (meta?.initialized) {
      return;
    }

    const legacy = db.prepare("SELECT state FROM store_snapshots WHERE id = 1").get() as { state: string } | undefined;
    if (legacy) {
      persistLegacySnapshot(legacy.state);
    }
  }
};
