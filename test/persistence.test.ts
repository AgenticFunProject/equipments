import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  loadRuntimeConfig,
  normalizeBackend,
  STORAGE_BACKEND_ENV,
  STORAGE_DB_PATH_ENV,
  STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV,
  STORAGE_SQLITE_PATH_ENV,
  StorageBackend
} from "../src/persistence.js";
import { createStoreFromRuntimeConfig } from "../src/store.js";

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
    const meta = db.prepare("SELECT initialized FROM store_meta WHERE id = 1").get() as { initialized: number };
    const equipmentTypeRow = db.prepare("SELECT code, description FROM equipment_types WHERE code = ?").get("45HC") as {
      code: string;
      description: string;
    };
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

    assert.equal(meta.initialized, 1);
    assert.equal(equipmentTypeRow.code, "45HC");
    assert.equal(equipmentTypeRow.description, "45-foot High Cube");
    assert.equal(containerCount.count, 2);
    assert.equal(reservationRow.bookingReference, "BOOK-45HC");
    assert.equal(reservationRow.originDepot, "NLRTM-01");
    assert.equal(auditRow.actor, "planner");
    assert.equal(auditRow.action, "reservation.create");
    assert.deepEqual(
      links.map((item) => item.containerId),
      [first.id, second.id]
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
