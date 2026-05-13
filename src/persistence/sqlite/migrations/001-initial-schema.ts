import type { SqliteMigration } from "./types.js";

export const initialSchemaMigration: SqliteMigration = {
  version: 1,
  apply: ({ db }) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS store_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS equipment_types (
        code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        nominal_length TEXT NOT NULL,
        max_payload_kg REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        container_number TEXT NOT NULL UNIQUE,
        equipment_type TEXT NOT NULL,
        status TEXT NOT NULL,
        current_depot TEXT NOT NULL,
        booking_reference TEXT,
        last_moved_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (equipment_type) REFERENCES equipment_types(code)
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        booking_reference TEXT NOT NULL UNIQUE,
        origin_depot TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservation_containers (
        reservation_id TEXT NOT NULL,
        container_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        PRIMARY KEY (reservation_id, container_id),
        FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
        FOREIGN KEY (container_id) REFERENCES containers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS store_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL
      );
    `);
  }
};
