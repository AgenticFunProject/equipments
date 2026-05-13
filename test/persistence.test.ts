import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createPersistence,
  loadRuntimeConfig,
  normalizeBackend,
  SQLITE_SCHEMA_VERSION,
  STORAGE_BACKEND_ENV,
  STORAGE_DB_PATH_ENV,
  STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV,
  STORAGE_SQLITE_PATH_ENV,
  StorageBackend
} from "../src/persistence/index.js";
import { parseSnapshot } from "../src/persistence/snapshot.js";
import type { StoreSnapshot } from "../src/persistence/index.js";
import { createStoreFromRuntimeConfig } from "../src/store.js";

function createSnapshot(): StoreSnapshot {
  return {
    auditEvents: [],
    equipmentTypes: [
      {
        code: "45HC",
        description: "45-foot High Cube",
        nominalLength: "45'",
        maxPayloadKg: 29500,
        createdByUserId: "usr-local-1",
        lastModifiedByUserId: "usr-local-1",
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    ],
    users: [
      {
        id: "usr-local-1",
        externalIdentity: "platform-auth:ops-agent",
        issuer: "platform-auth",
        subject: "ops-agent",
        displayName: "Ops Agent",
        email: "ops-agent@example.com",
        status: "ACTIVE",
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T01:00:00.000Z"
      }
    ],
    containers: [
      {
        id: "ctr-local-1",
        containerNumber: "MSCU1234567",
        equipmentType: "45HC",
        status: "AVAILABLE",
        currentDepot: "NLRTM-01",
        bookingReference: null,
        createdByUserId: "usr-local-1",
        lastModifiedByUserId: "usr-local-1",
        lastMovedAt: "2026-04-22T00:10:00.000Z",
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:10:00.000Z"
      }
    ],
    reservations: [
      {
        id: "res-local-1",
        bookingReference: "BOOK-45HC",
        originDepot: "NLRTM-01",
        containers: ["ctr-local-1"],
        status: "ACTIVE",
        createdByUserId: "usr-local-1",
        lastModifiedByUserId: "usr-local-1",
        createdAt: "2026-04-22T00:20:00.000Z",
        updatedAt: "2026-04-22T00:20:00.000Z"
      }
    ]
  };
}

function normalizeSnapshot(snapshot: StoreSnapshot | null): StoreSnapshot | null {
  return snapshot ? JSON.parse(JSON.stringify(snapshot)) : snapshot;
}

function normalizeRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("normalizeBackend accepts sqlite aliases", () => {
  for (const value of ["sqlite", "sqlite3", "sql", "persistent-sqlite", "persistent-sqlite3"]) {
    assert.equal(normalizeBackend(value), StorageBackend.SQLITE);
  }
});

test("loadRuntimeConfig defaults to memory", () => {
  const config = loadRuntimeConfig({});
  assert.deepEqual(config, { backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false });
});

test("loadRuntimeConfig requires db path", () => {
  assert.throws(
    () => loadRuntimeConfig({ [STORAGE_BACKEND_ENV]: StorageBackend.DB }),
    /STORAGE_DB_PATH is required/
  );
});

test("loadRuntimeConfig accepts sqlite fallback path", () => {
  const config = loadRuntimeConfig({
    [STORAGE_BACKEND_ENV]: "sqlite3",
    [STORAGE_DB_PATH_ENV]: "/tmp/equipments.sqlite"
  });

  assert.deepEqual(config, {
    backend: StorageBackend.SQLITE,
    path: "/tmp/equipments.sqlite",
    sqliteEmptyOnFirstBoot: false
  });
});

test("loadRuntimeConfig enables empty sqlite first boot when requested", () => {
  const config = loadRuntimeConfig({
    [STORAGE_BACKEND_ENV]: StorageBackend.SQLITE,
    [STORAGE_SQLITE_PATH_ENV]: "/tmp/equipments.sqlite",
    [STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV]: "true"
  });

  assert.deepEqual(config, {
    backend: StorageBackend.SQLITE,
    path: "/tmp/equipments.sqlite",
    sqliteEmptyOnFirstBoot: true
  });
});

test("db backend persists store state across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-db-"));
  try {
    const path = join(dir, "equipments.json");
    const storeA = createStoreFromRuntimeConfig({ backend: StorageBackend.DB, path });
    const created = storeA.createEquipmentType({
      code: "45HC",
      description: "45-foot High Cube",
      nominalLength: "45'",
      maxPayloadKg: 29500
    });
    storeA.recordAuditEvent({
      actor: "ops-user",
      action: "equipment_type.create",
      resourceType: "equipment_type",
      resourceId: "45HC",
      timestamp: "2026-04-22T12:00:00.000Z",
      requestContext: { code: "45HC" },
      outcome: "success",
      errorMessage: null
    });

    const storeB = createStoreFromRuntimeConfig({ backend: StorageBackend.DB, path }, false);
    assert.equal(created.code, "45HC");
    assert.ok(storeB.listEquipmentTypes().some((item) => item.code === "45HC"));
    assert.equal(storeB.listAuditEvents().length, 1);
    assert.equal(storeB.listAuditEvents()[0].actor, "ops-user");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("db backend round-trips local users in persisted snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-db-users-"));
  try {
    const path = join(dir, "equipments.json");
    const persistence = createPersistence({ backend: StorageBackend.DB, path });
    const snapshot = createSnapshot();

    persistence.save(snapshot);

    assert.deepEqual(persistence.load(), snapshot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend persists store state across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const storeA = createStoreFromRuntimeConfig({ backend: StorageBackend.SQLITE, path });
    const created = storeA.registerContainer({
      containerNumber: "CONU9999999",
      equipmentType: "20FT",
      currentDepot: "NLRTM-01"
    });
    storeA.recordAuditEvent({
      actor: "ops-user",
      action: "container.register",
      resourceType: "container",
      resourceId: created.id,
      timestamp: "2026-04-22T12:05:00.000Z",
      requestContext: { containerNumber: "CONU9999999" },
      outcome: "success",
      errorMessage: null
    });

    const storeB = createStoreFromRuntimeConfig({ backend: StorageBackend.SQLITE, path }, false);
    assert.equal(created.containerNumber, "CONU9999999");
    assert.ok(storeB.listContainers({ depot: "NLRTM-01" }).some((item) => item.containerNumber === "CONU9999999"));
    assert.equal(storeB.listAuditEvents().length, 1);
    assert.equal(storeB.listAuditEvents()[0].resourceId, created.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend stores state in relational tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-relational-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const store = createStoreFromRuntimeConfig({ backend: StorageBackend.SQLITE, path }, false);
    store.createEquipmentType({
      code: "45HC",
      description: "45-foot High Cube",
      nominalLength: "45'",
      maxPayloadKg: 29500
    });

    const first = store.registerContainer({
      containerNumber: "MSCU1234567",
      equipmentType: "45HC",
      currentDepot: "NLRTM-01"
    });
    const second = store.registerContainer({
      containerNumber: "MSCU1234568",
      equipmentType: "45HC",
      currentDepot: "NLRTM-01"
    });

    const { reservation } = store.createReservation({
      bookingReference: "BOOK-45HC",
      originDepot: "NLRTM-01",
      equipment: [{ type: "45HC", quantity: 2 }]
    });
    store.recordAuditEvent({
      actor: "planner",
      action: "reservation.create",
      resourceType: "reservation",
      resourceId: reservation.id,
      timestamp: "2026-04-22T12:10:00.000Z",
      requestContext: { bookingReference: "BOOK-45HC" },
      outcome: "success",
      errorMessage: null
    });

    const db = new DatabaseSync(path);
    const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
    const meta = db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as { initialized: number };
    const equipmentTypeRow = db.prepare("SELECT code, description FROM equipment_types WHERE code = ?").get("45HC") as {
      code: string;
      description: string;
    };
    const indexNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('containers', 'reservations', 'reservation_containers', 'audit_events')")
      .all() as Array<{ name: string }>;
    const containerCount = db.prepare("SELECT COUNT(*) AS count FROM containers").get() as { count: number };
    const reservationRow = db
      .prepare("SELECT booking_reference AS bookingReference, origin_depot AS originDepot FROM reservations WHERE id = ?")
      .get(reservation.id) as { bookingReference: string; originDepot: string };
    const links = db
      .prepare(
        "SELECT container_id AS containerId FROM reservation_containers WHERE reservation_id = ? ORDER BY order_index"
      )
      .all(reservation.id) as Array<{ containerId: string }>;
    const auditRow = db.prepare("SELECT actor, action FROM audit_events WHERE resource_id = ?").get(reservation.id) as {
      actor: string;
      action: string;
    };

    assert.equal(userVersion.user_version, SQLITE_SCHEMA_VERSION);
    assert.equal(meta.initialized, 1);
    assert.equal(equipmentTypeRow.code, "45HC");
    assert.equal(equipmentTypeRow.description, "45-foot High Cube");
    assert.equal(containerCount.count, 2);
    assert.equal(reservationRow.bookingReference, "BOOK-45HC");
    assert.equal(reservationRow.originDepot, "NLRTM-01");
    assert.equal(auditRow.actor, "planner");
    assert.equal(auditRow.action, "reservation.create");
    assert.ok(indexNames.some((index) => index.name === "idx_containers_availability"));
    assert.ok(indexNames.some((index) => index.name === "idx_containers_booking_reference"));
    assert.ok(indexNames.some((index) => index.name === "idx_reservations_origin_status"));
    assert.ok(indexNames.some((index) => index.name === "idx_reservation_containers_container_id"));
    assert.ok(indexNames.some((index) => index.name === "idx_audit_events_resource_time"));
    assert.deepEqual(
      links.map((item) => item.containerId),
      [first.id, second.id]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend persists local users in relational tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-users-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const persistence = createPersistence({ backend: StorageBackend.SQLITE, path });
    const snapshot = createSnapshot();

    persistence.save(snapshot);

    const loaded = persistence.load();
    const db = new DatabaseSync(path);
    const userRow = db
      .prepare(
        `SELECT
          id,
          external_identity AS externalIdentity,
          issuer,
          subject,
          display_name AS displayName,
          email,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM users
        WHERE id = ?`
      )
      .get(snapshot.users[0].id) as {
      id: string;
      externalIdentity: string;
      issuer: string;
      subject: string;
      displayName: string | null;
      email: string | null;
      status: string;
      createdAt: string;
      updatedAt: string;
    };

    assert.deepEqual(normalizeSnapshot(loaded), snapshot);
    assert.deepEqual(normalizeRecord(userRow), snapshot.users[0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseSnapshot backfills new local user profile fields", () => {
  const snapshot = parseSnapshot(
    JSON.stringify({
      users: [
        {
          id: "usr-local-1",
          issuer: "platform-auth",
          subject: "ops-agent",
          createdAt: "2026-04-22T00:00:00.000Z"
        }
      ]
    })
  );

  assert.deepEqual(snapshot.users, [
    {
      id: "usr-local-1",
      externalIdentity: "platform-auth:ops-agent",
      issuer: "platform-auth",
      subject: "ops-agent",
      displayName: null,
      email: null,
      status: "ACTIVE",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    }
  ]);
});

test("sqlite backend persists audit metadata columns for business records", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-audit-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const persistence = createPersistence({ backend: StorageBackend.SQLITE, path });
    const snapshot = createSnapshot();

    persistence.save(snapshot);

    const db = new DatabaseSync(path);
    const equipmentTypeRow = db
      .prepare(
        `SELECT
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM equipment_types
        WHERE code = ?`
      )
      .get(snapshot.equipmentTypes[0].code) as {
      createdByUserId: string;
      lastModifiedByUserId: string;
      createdAt: string;
      updatedAt: string;
    };
    const containerRow = db
      .prepare(
        `SELECT
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          updated_at AS updatedAt
        FROM containers
        WHERE id = ?`
      )
      .get(snapshot.containers[0].id) as {
      createdByUserId: string;
      lastModifiedByUserId: string;
      updatedAt: string;
    };
    const reservationRow = db
      .prepare(
        `SELECT
          created_by_user_id AS createdByUserId,
          last_modified_by_user_id AS lastModifiedByUserId,
          updated_at AS updatedAt
        FROM reservations
        WHERE id = ?`
      )
      .get(snapshot.reservations[0].id) as {
      createdByUserId: string;
      lastModifiedByUserId: string;
      updatedAt: string;
    };

    assert.deepEqual(normalizeRecord(equipmentTypeRow), {
      createdByUserId: snapshot.equipmentTypes[0].createdByUserId,
      lastModifiedByUserId: snapshot.equipmentTypes[0].lastModifiedByUserId,
      createdAt: snapshot.equipmentTypes[0].createdAt,
      updatedAt: snapshot.equipmentTypes[0].updatedAt
    });
    assert.deepEqual(normalizeRecord(containerRow), {
      createdByUserId: snapshot.containers[0].createdByUserId,
      lastModifiedByUserId: snapshot.containers[0].lastModifiedByUserId,
      updatedAt: snapshot.containers[0].updatedAt
    });
    assert.deepEqual(normalizeRecord(reservationRow), {
      createdByUserId: snapshot.reservations[0].createdByUserId,
      lastModifiedByUserId: snapshot.reservations[0].lastModifiedByUserId,
      updatedAt: snapshot.reservations[0].updatedAt
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend enforces relational check constraints", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-constraints-"));
  try {
    const path = join(dir, "equipments.sqlite");
    createPersistence({ backend: StorageBackend.SQLITE, path });

    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO equipment_types (
            code,
            description,
            nominal_length,
            max_payload_kg,
            created_by_user_id,
            last_modified_by_user_id,
            created_at,
            updated_at
          ) VALUES ('BAD', '', '20''', 1000, NULL, NULL, '2026-04-22T00:00:00.000Z', '2026-04-22T00:00:00.000Z')`
        ).run(),
      /constraint/i
    );

    assert.throws(
      () =>
        db.prepare(
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
          ) VALUES ('ctr-1', 'MSCU1234567', 'NOPE', 'INVALID', 'NLRTM-01', NULL, NULL, NULL, '2026-04-22T00:00:00.000Z', '2026-04-22T00:00:00.000Z', '2026-04-22T00:00:00.000Z')`
        ).run(),
      /constraint/i
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend can start empty on first boot", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-empty-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const storeA = createStoreFromRuntimeConfig(
      { backend: StorageBackend.SQLITE, path, sqliteEmptyOnFirstBoot: true },
      true
    );
    assert.deepEqual(storeA.listEquipmentTypes(), []);
    assert.deepEqual(storeA.listContainers({}), []);

    storeA.createEquipmentType({
      code: "45HC",
      description: "45-foot High Cube",
      nominalLength: "45'",
      maxPayloadKg: 29500
    });

    const storeB = createStoreFromRuntimeConfig(
      { backend: StorageBackend.SQLITE, path, sqliteEmptyOnFirstBoot: true },
      true
    );
    assert.ok(storeB.listEquipmentTypes().some((item) => item.code === "45HC"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend migrates older schema versions forward", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-migrate-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      PRAGMA user_version = 1;

      CREATE TABLE store_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized INTEGER NOT NULL
      );

      CREATE TABLE equipment_types (
        code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        nominal_length TEXT NOT NULL,
        max_payload_kg REAL NOT NULL
      );

      CREATE TABLE containers (
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

      CREATE TABLE reservations (
        id TEXT PRIMARY KEY,
        booking_reference TEXT NOT NULL UNIQUE,
        origin_depot TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE reservation_containers (
        reservation_id TEXT NOT NULL,
        container_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        PRIMARY KEY (reservation_id, container_id)
      );

      CREATE TABLE store_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL
      );

      INSERT INTO store_meta (id, initialized) VALUES (1, 1);
      INSERT INTO equipment_types (code, description, nominal_length, max_payload_kg) VALUES ('20FT', 'Twenty foot', '20''', 28200);
      INSERT INTO containers (id, container_number, equipment_type, status, current_depot, booking_reference, last_moved_at, created_at)
      VALUES ('ctr-1', 'CONU1234567', '20FT', 'AVAILABLE', 'CNSHA-01', NULL, '2026-04-22T00:10:00.000Z', '2026-04-22T00:00:00.000Z');
      INSERT INTO reservations (id, booking_reference, origin_depot, status, created_at)
      VALUES ('res-1', 'BKG-1', 'CNSHA-01', 'ACTIVE', '2026-04-22T00:20:00.000Z');
    `);

    createPersistence({ backend: StorageBackend.SQLITE, path });

    const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
    const usersTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { name: string };
    const auditTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'").get() as { name: string };
    const legacySnapshotTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'store_snapshots'").get() as
      | { name: string }
      | undefined;
    const equipmentColumns = db.prepare("PRAGMA table_info(equipment_types)").all() as Array<{ name: string }>;
    const containerColumns = db.prepare("PRAGMA table_info(containers)").all() as Array<{ name: string }>;
    const reservationColumns = db.prepare("PRAGMA table_info(reservations)").all() as Array<{ name: string }>;
    const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;

    assert.equal(userVersion.user_version, SQLITE_SCHEMA_VERSION);
    assert.equal(usersTable.name, "users");
    assert.equal(auditTable.name, "audit_events");
    assert.equal(legacySnapshotTable, undefined);
    assert.ok(userColumns.some((column) => column.name === "external_identity"));
    assert.ok(userColumns.some((column) => column.name === "display_name"));
    assert.ok(userColumns.some((column) => column.name === "email"));
    assert.ok(userColumns.some((column) => column.name === "status"));
    assert.ok(userColumns.some((column) => column.name === "updated_at"));
    assert.ok(equipmentColumns.some((column) => column.name === "created_by_user_id"));
    assert.ok(equipmentColumns.some((column) => column.name === "updated_at"));
    assert.ok(containerColumns.some((column) => column.name === "last_modified_by_user_id"));
    assert.ok(containerColumns.some((column) => column.name === "updated_at"));
    assert.ok(reservationColumns.some((column) => column.name === "last_modified_by_user_id"));
    assert.ok(reservationColumns.some((column) => column.name === "updated_at"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend backfills user profile columns during migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-users-migrate-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      PRAGMA user_version = 3;

      CREATE TABLE store_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        initialized INTEGER NOT NULL
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        request_context TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error_message TEXT
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (issuer, subject)
      );

      CREATE TABLE equipment_types (
        code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        nominal_length TEXT NOT NULL,
        max_payload_kg REAL NOT NULL,
        created_by_user_id TEXT,
        last_modified_by_user_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE containers (
        id TEXT PRIMARY KEY,
        container_number TEXT NOT NULL UNIQUE,
        equipment_type TEXT NOT NULL,
        status TEXT NOT NULL,
        current_depot TEXT NOT NULL,
        booking_reference TEXT,
        last_moved_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by_user_id TEXT,
        last_modified_by_user_id TEXT,
        updated_at TEXT
      );

      CREATE TABLE reservations (
        id TEXT PRIMARY KEY,
        booking_reference TEXT NOT NULL UNIQUE,
        origin_depot TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by_user_id TEXT,
        last_modified_by_user_id TEXT,
        updated_at TEXT
      );

      CREATE TABLE reservation_containers (
        reservation_id TEXT NOT NULL,
        container_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        PRIMARY KEY (reservation_id, container_id)
      );

      INSERT INTO store_meta (id, initialized) VALUES (1, 1);
      INSERT INTO users (id, issuer, subject, created_at)
      VALUES ('usr-local-1', 'platform-auth', 'ops-agent', '2026-04-22T00:00:00.000Z');
    `);

    const persistence = createPersistence({ backend: StorageBackend.SQLITE, path });
    const loaded = persistence.load();
    const userRow = db
      .prepare(
        `SELECT
          external_identity AS externalIdentity,
          display_name AS displayName,
          email,
          status,
          updated_at AS updatedAt
        FROM users
        WHERE id = 'usr-local-1'`
      )
      .get() as {
      externalIdentity: string;
      displayName: string | null;
      email: string | null;
      status: string;
      updatedAt: string;
    };

    assert.deepEqual(normalizeSnapshot(loaded)?.users, [
      {
        id: "usr-local-1",
        externalIdentity: "platform-auth:ops-agent",
        issuer: "platform-auth",
        subject: "ops-agent",
        displayName: null,
        email: null,
        status: "ACTIVE",
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    ]);
    assert.deepEqual(normalizeRecord(userRow), {
      externalIdentity: "platform-auth:ops-agent",
      displayName: null,
      email: null,
      status: "ACTIVE",
      updatedAt: "2026-04-22T00:00:00.000Z"
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite backend rejects unsupported future schema versions", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-sqlite-future-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);

    assert.throws(
      () => createPersistence({ backend: StorageBackend.SQLITE, path }),
      new RegExp(`sqlite schema version ${SQLITE_SCHEMA_VERSION + 1} is newer than supported version ${SQLITE_SCHEMA_VERSION}`)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory backend does not persist across store recreation", () => {
  const storeA = createStoreFromRuntimeConfig({ backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false });
  const storeB = createStoreFromRuntimeConfig(
    { backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false },
    false
  );

  storeA.createEquipmentType({
    code: "53FT",
    description: "Domestic 53-foot container",
    nominalLength: "53'",
    maxPayloadKg: 30000
  });

  assert.equal(storeA.listEquipmentTypes().some((item) => item.code === "53FT"), true);
  assert.equal(storeB.listEquipmentTypes().some((item) => item.code === "53FT"), false);
});
