import type { PostgresMigrationContext } from "../../migration-context.js";
import {
  AUDIT_OUTCOME_VALUES,
  CONTAINER_STATUS_VALUES,
  RESERVATION_STATUS_VALUES,
  migrateLegacyPostgresSnapshot
} from "../../postgres.js";

export async function up({ context }: { context: PostgresMigrationContext }): Promise<void> {
  await context.client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY CHECK (id <> ''),
      external_identity text NOT NULL UNIQUE CHECK (external_identity <> ''),
      issuer text NOT NULL CHECK (issuer <> ''),
      subject text NOT NULL CHECK (subject <> ''),
      display_name text,
      email text,
      status text NOT NULL CHECK (status <> ''),
      created_at text NOT NULL CHECK (created_at <> ''),
      updated_at text NOT NULL CHECK (updated_at <> ''),
      UNIQUE (issuer, subject)
    );

    CREATE TABLE IF NOT EXISTS equipment_types (
      code text PRIMARY KEY CHECK (code <> ''),
      description text NOT NULL CHECK (description <> ''),
      nominal_length text NOT NULL CHECK (nominal_length <> ''),
      max_payload_kg double precision NOT NULL CHECK (max_payload_kg > 0),
      created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      last_modified_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      created_at text NOT NULL CHECK (created_at <> ''),
      updated_at text NOT NULL CHECK (updated_at <> '')
    );

    CREATE TABLE IF NOT EXISTS containers (
      id text PRIMARY KEY CHECK (id <> ''),
      container_number text NOT NULL UNIQUE CHECK (container_number <> ''),
      equipment_type text NOT NULL REFERENCES equipment_types(code) CHECK (equipment_type <> ''),
      status text NOT NULL CHECK (status IN (${CONTAINER_STATUS_VALUES})),
      current_depot text NOT NULL CHECK (current_depot <> ''),
      booking_reference text CHECK (booking_reference IS NULL OR booking_reference <> ''),
      created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      last_modified_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      last_moved_at text NOT NULL CHECK (last_moved_at <> ''),
      created_at text NOT NULL CHECK (created_at <> ''),
      updated_at text NOT NULL CHECK (updated_at <> '')
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id text PRIMARY KEY CHECK (id <> ''),
      booking_reference text NOT NULL UNIQUE CHECK (booking_reference <> ''),
      origin_depot text NOT NULL CHECK (origin_depot <> ''),
      status text NOT NULL CHECK (status IN (${RESERVATION_STATUS_VALUES})),
      created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      last_modified_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      created_at text NOT NULL CHECK (created_at <> ''),
      updated_at text NOT NULL CHECK (updated_at <> '')
    );

    CREATE TABLE IF NOT EXISTS reservation_containers (
      reservation_id text NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      container_id text NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
      order_index integer NOT NULL CHECK (order_index >= 0),
      PRIMARY KEY (reservation_id, container_id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id text PRIMARY KEY CHECK (id <> ''),
      actor text NOT NULL CHECK (actor <> ''),
      action text NOT NULL CHECK (action <> ''),
      resource_type text NOT NULL CHECK (resource_type <> ''),
      resource_id text NOT NULL CHECK (resource_id <> ''),
      timestamp text NOT NULL CHECK (timestamp <> ''),
      request_context jsonb NOT NULL,
      outcome text NOT NULL CHECK (outcome IN (${AUDIT_OUTCOME_VALUES})),
      error_message text
    );
  `);
  await context.client.query(`
    CREATE INDEX IF NOT EXISTS idx_containers_availability
      ON containers (equipment_type, current_depot, status)
  `);
  await context.client.query(`
    CREATE INDEX IF NOT EXISTS idx_containers_booking_reference
      ON containers (booking_reference)
  `);
  await context.client.query(`
    CREATE INDEX IF NOT EXISTS idx_reservations_origin_status
      ON reservations (origin_depot, status)
  `);
  await context.client.query(`
    CREATE INDEX IF NOT EXISTS idx_reservation_containers_container_id
      ON reservation_containers (container_id)
  `);
  await context.client.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_resource_time
      ON audit_events (resource_type, resource_id, timestamp)
  `);
  await migrateLegacyPostgresSnapshot(context.client);
}
