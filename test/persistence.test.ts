import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadRuntimeConfig,
  normalizeBackend,
  STORAGE_BACKEND_ENV,
  STORAGE_DB_PATH_ENV,
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
  assert.deepEqual(config, { backend: StorageBackend.MEMORY, path: "" });
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
    path: "/tmp/equipments.sqlite"
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

    const storeB = createStoreFromRuntimeConfig({ backend: StorageBackend.DB, path }, false);
    assert.equal(created.code, "45HC");
    assert.ok(storeB.listEquipmentTypes().some((item) => item.code === "45HC"));
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

    const storeB = createStoreFromRuntimeConfig({ backend: StorageBackend.SQLITE, path }, false);
    assert.equal(created.containerNumber, "CONU9999999");
    assert.ok(storeB.listContainers({ depot: "NLRTM-01" }).some((item) => item.containerNumber === "CONU9999999"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory backend does not persist across store recreation", () => {
  const storeA = createStoreFromRuntimeConfig({ backend: StorageBackend.MEMORY, path: "" });
  const storeB = createStoreFromRuntimeConfig({ backend: StorageBackend.MEMORY, path: "" }, false);

  storeA.createEquipmentType({
    code: "53FT",
    description: "Domestic 53-foot container",
    nominalLength: "53'",
    maxPayloadKg: 30000
  });

  assert.equal(storeA.listEquipmentTypes().some((item) => item.code === "53FT"), true);
  assert.equal(storeB.listEquipmentTypes().some((item) => item.code === "53FT"), false);
});
