import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AuditEvent, ContainerUnit, EquipmentType, LocalUser, Reservation } from "../types.js";

import { runSqliteMigrations } from "./sqlite/migrations/index.js";
import { parseSnapshot } from "./snapshot.js";
import { SQLITE_SCHEMA_VERSION, type StorePersistence, type StoreSnapshot } from "./types.js";

export class SqlitePersistence implements StorePersistence {
  private readonly db: DatabaseSync;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    runSqliteMigrations(this.db, {
      supportedVersion: SQLITE_SCHEMA_VERSION,
      persistLegacySnapshot: (state) => {
        this.save(parseSnapshot(state));
      }
    });
  }

  load(): StoreSnapshot | null {
    const meta = this.db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as
      | { initialized: number }
      | undefined;
    if (!meta?.initialized) {
      return null;
    }

    const auditEvents = this.db
      .prepare(
        `SELECT
          id,
          actor,
          action,
          resource_type AS resourceType,
          resource_id AS resourceId,
          timestamp,
          request_context AS requestContext,
          outcome,
          error_message AS errorMessage
        FROM audit_events
        ORDER BY timestamp, id`
      )
      .all()
      .map((row) => ({
        ...(row as Omit<AuditEvent, "requestContext"> & { requestContext: string }),
        requestContext: JSON.parse((row as { requestContext: string }).requestContext) as AuditEvent["requestContext"]
      }));

    const equipmentTypes = this.db
      .prepare(
        `SELECT
          code,
          description,
          nominal_length AS nominalLength,
          max_payload_kg AS maxPayloadKg,
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM equipment_types
        ORDER BY code`
      )
      .all() as unknown as EquipmentType[];
    const users = this.db
      .prepare(
        `SELECT
          id,
          COALESCE(external_identity, issuer || ':' || subject) AS externalIdentity,
          issuer,
          subject,
          display_name AS displayName,
          email,
          COALESCE(status, 'ACTIVE') AS status,
          created_at AS createdAt,
          COALESCE(updated_at, created_at) AS updatedAt
        FROM users
        ORDER BY created_at, id`
      )
      .all() as unknown as LocalUser[];
    const containers = this.db
      .prepare(
        `SELECT
          id,
          container_number AS containerNumber,
          equipment_type AS equipmentType,
          status,
          current_depot AS currentDepot,
          booking_reference AS bookingReference,
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          last_moved_at AS lastMovedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM containers
        ORDER BY created_at, id`
      )
      .all() as unknown as ContainerUnit[];
    const reservations = this.db
      .prepare(
        `SELECT
          id,
          booking_reference AS bookingReference,
          origin_depot AS originDepot,
          status,
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM reservations
        ORDER BY created_at, id`
      )
      .all() as unknown as Array<Omit<Reservation, "containers">>;
    const reservationContainers = this.db
      .prepare(
        `SELECT reservation_id AS reservationId, container_id AS containerId
        FROM reservation_containers
        ORDER BY reservation_id, order_index`
      )
      .all() as unknown as Array<{ reservationId: string; containerId: string }>;
    const containersByReservation = new Map<string, string[]>();

    for (const item of reservationContainers) {
      const containerIds = containersByReservation.get(item.reservationId) ?? [];
      containerIds.push(item.containerId);
      containersByReservation.set(item.reservationId, containerIds);
    }

    return {
      auditEvents,
      equipmentTypes,
      users,
      containers,
      reservations: reservations.map((reservation) => ({
        ...reservation,
        containers: containersByReservation.get(reservation.id) ?? []
      }))
    };
  }

  save(snapshot: StoreSnapshot): void {
    const upsertMeta = this.db.prepare(
      "INSERT INTO store_meta (id, initialized) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET initialized = excluded.initialized"
    );
    const insertAuditEvent = this.db.prepare(
      `INSERT INTO audit_events (
        id,
        actor,
        action,
        resource_type,
        resource_id,
        timestamp,
        request_context,
        outcome,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertEquipmentType = this.db.prepare(
      `INSERT INTO equipment_types (
        code,
        description,
        nominal_length,
        max_payload_kg,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertUser = this.db.prepare(
      `INSERT INTO users (
        id,
        external_identity,
        issuer,
        subject,
        display_name,
        email,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertContainer = this.db.prepare(
      `INSERT INTO containers (
        id,
        container_number,
        equipment_type,
        status,
        current_depot,
        booking_reference,
        created_by_user_id,
        last_modified_by_user_id,
        last_moved_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertReservation = this.db.prepare(
      `INSERT INTO reservations (
        id,
        booking_reference,
        origin_depot,
        status,
        created_by_user_id,
        last_modified_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertReservationContainer = this.db.prepare(
      "INSERT INTO reservation_containers (reservation_id, container_id, order_index) VALUES (?, ?, ?)"
    );

    this.db.exec("BEGIN");
    try {
      upsertMeta.run();
      this.db.exec(
        "DELETE FROM audit_events; DELETE FROM reservation_containers; DELETE FROM reservations; DELETE FROM containers; DELETE FROM users; DELETE FROM equipment_types; DELETE FROM store_snapshots;"
      );

      for (const auditEvent of snapshot.auditEvents) {
        insertAuditEvent.run(
          auditEvent.id,
          auditEvent.actor,
          auditEvent.action,
          auditEvent.resourceType,
          auditEvent.resourceId,
          auditEvent.timestamp,
          JSON.stringify(auditEvent.requestContext),
          auditEvent.outcome,
          auditEvent.errorMessage
        );
      }

      for (const equipmentType of snapshot.equipmentTypes) {
        insertEquipmentType.run(
          equipmentType.code,
          equipmentType.description,
          equipmentType.nominalLength,
          equipmentType.maxPayloadKg,
          equipmentType.createdByUserId,
          equipmentType.lastModifiedByUserId,
          equipmentType.createdAt,
          equipmentType.updatedAt
        );
      }

      for (const user of snapshot.users) {
        insertUser.run(
          user.id,
          user.externalIdentity,
          user.issuer,
          user.subject,
          user.displayName,
          user.email,
          user.status,
          user.createdAt,
          user.updatedAt
        );
      }

      for (const container of snapshot.containers) {
        insertContainer.run(
          container.id,
          container.containerNumber,
          container.equipmentType,
          container.status,
          container.currentDepot,
          container.bookingReference,
          container.createdByUserId,
          container.lastModifiedByUserId,
          container.lastMovedAt,
          container.createdAt,
          container.updatedAt
        );
      }

      for (const reservation of snapshot.reservations) {
        insertReservation.run(
          reservation.id,
          reservation.bookingReference,
          reservation.originDepot,
          reservation.status,
          reservation.createdByUserId,
          reservation.lastModifiedByUserId,
          reservation.createdAt,
          reservation.updatedAt
        );

        reservation.containers.forEach((containerId, index) => {
          insertReservationContainer.run(reservation.id, containerId, index);
        });
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
