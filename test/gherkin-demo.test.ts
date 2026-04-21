import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { StorageBackend } from "../src/persistence.js";
import { buildServer } from "../src/server.js";
import { createStoreFromRuntimeConfig } from "../src/store.js";

interface DemoState {
  app: FastifyInstance | null;
  tempDir: string | null;
  latestStatusCode: number | null;
  latestBody: unknown;
  latestReservedContainerId: string | null;
  latestContainerId: string | null;
}

interface StepDefinition {
  pattern: RegExp;
  run: (state: DemoState, ...captures: string[]) => Promise<void>;
}

test("DEMO.md Gherkin flow runs automatically", async (t) => {
  const state: DemoState = {
    app: null,
    tempDir: null,
    latestStatusCode: null,
    latestBody: null,
    latestReservedContainerId: null,
    latestContainerId: null
  };

  t.after(async () => {
    await state.app?.close();
    if (state.tempDir) {
      rmSync(state.tempDir, { recursive: true, force: true });
    }
  });

  const steps = parseFeatureSteps(join(import.meta.dirname, "features", "demo.feature"));
  for (const step of steps) {
    await runStep(step, state);
  }
});

function parseFeatureSteps(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(Given|When|Then|And) /.test(line))
    .map((line) => line.replace(/^(Given|When|Then|And) /, ""));
}

async function runStep(step: string, state: DemoState): Promise<void> {
  for (const definition of stepDefinitions) {
    const match = step.match(definition.pattern);
    if (!match) {
      continue;
    }

    await definition.run(state, ...match.slice(1));
    return;
  }

  throw new Error(`No step definition matched: ${step}`);
}

async function request(state: DemoState, method: string, url: string, payload?: unknown): Promise<void> {
  assert.ok(state.app, "expected demo app to be initialized");
  const response = await state.app.inject({ method, url, payload } as any);
  state.latestStatusCode = response.statusCode;
  state.latestBody = response.json();
}

function latestBody<T>(state: DemoState): T {
  return state.latestBody as T;
}

const stepDefinitions: StepDefinition[] = [
  {
    pattern: /^the equipments service starts from an empty sqlite database$/,
    run: async (state) => {
      state.tempDir = mkdtempSync(join(tmpdir(), "equipments-gherkin-"));
      const path = join(state.tempDir, "demo.sqlite");
      const store = createStoreFromRuntimeConfig(
        { backend: StorageBackend.SQLITE, path, sqliteEmptyOnFirstBoot: true },
        true
      );
      state.app = buildServer(store, { backend: StorageBackend.SQLITE, path, sqliteEmptyOnFirstBoot: true });
    }
  },
  {
    pattern: /^the equipment type catalog is empty$/,
    run: async (state) => {
      await request(state, "GET", "/equipment-types");
      assert.equal(state.latestStatusCode, 200);
      assert.deepEqual(latestBody<{ equipmentTypes: unknown[] }>(state), { equipmentTypes: [] });
    }
  },
  {
    pattern: /^the container inventory is empty$/,
    run: async (state) => {
      await request(state, "GET", "/containers");
      assert.equal(state.latestStatusCode, 200);
      assert.deepEqual(latestBody<{ containers: unknown[] }>(state), { containers: [] });
    }
  },
  {
    pattern: /^availability at depot "([^"]+)" is empty$/,
    run: async (state, depotCode) => {
      await request(state, "GET", `/availability?depotCode=${encodeURIComponent(depotCode)}`);
      assert.equal(state.latestStatusCode, 200);
      assert.deepEqual(latestBody<{ availability: unknown[] }>(state), { availability: [] });
    }
  },
  {
    pattern: /^I create equipment type "([^"]+)" described as "([^"]+)" with nominal length "([^"]+)" and max payload (\d+)$/,
    run: async (state, code, description, nominalLength, maxPayloadKg) => {
      await request(state, "POST", "/equipment-types", {
        code,
        description,
        nominalLength,
        maxPayloadKg: Number(maxPayloadKg)
      });
      assert.equal(state.latestStatusCode, 201);
    }
  },
  {
    pattern: /^the equipment type catalog contains (\d+) entries$/,
    run: async (state, count) => {
      await request(state, "GET", "/equipment-types");
      assert.equal(state.latestStatusCode, 200);
      assert.equal(latestBody<{ equipmentTypes: unknown[] }>(state).equipmentTypes.length, Number(count));
    }
  },
  {
    pattern: /^I register container "([^"]+)" of type "([^"]+)" at depot "([^"]+)"$/,
    run: async (state, containerNumber, equipmentType, currentDepot) => {
      await request(state, "POST", "/containers", { containerNumber, equipmentType, currentDepot });
      assert.equal(state.latestStatusCode, 201);
    }
  },
  {
    pattern: /^the container inventory contains (\d+) entries$/,
    run: async (state, count) => {
      await request(state, "GET", "/containers");
      assert.equal(state.latestStatusCode, 200);
      assert.equal(latestBody<{ containers: unknown[] }>(state).containers.length, Number(count));
    }
  },
  {
    pattern: /^availability at depot "([^"]+)" shows (\d+) units of "([^"]+)"$/,
    run: async (state, depotCode, count, equipmentType) => {
      await request(state, "GET", `/availability?depotCode=${encodeURIComponent(depotCode)}`);
      assert.equal(state.latestStatusCode, 200);
      const item = latestBody<{ availability: Array<{ equipmentType: string; availableCount: number; depotCode: string }> }>(state)
        .availability.find((entry) => entry.equipmentType === equipmentType && entry.depotCode === depotCode);
      assert.ok(item, `expected availability for ${equipmentType} at ${depotCode}`);
      assert.equal(item.availableCount, Number(count));
    }
  },
  {
    pattern: /^I reserve (\d+) units of "([^"]+)" at depot "([^"]+)" for booking "([^"]+)"$/,
    run: async (state, quantity, type, originDepot, bookingReference) => {
      await request(state, "POST", "/reservations", {
        bookingReference,
        originDepot,
        equipment: [{ type, quantity: Number(quantity) }]
      });
      assert.equal(state.latestStatusCode, 201);
      const body = latestBody<{ assignedContainers: Array<{ containerId: string }> }>(state);
      state.latestReservedContainerId = body.assignedContainers[0]?.containerId ?? null;
      state.latestContainerId = state.latestReservedContainerId;
    }
  },
  {
    pattern: /^the latest reservation has an assigned container$/,
    run: async (state) => {
      assert.ok(state.latestReservedContainerId, "expected latest reservation to assign a container");
    }
  },
  {
    pattern: /^I pick up the latest reserved container$/,
    run: async (state) => {
      assert.ok(state.latestReservedContainerId, "expected a reserved container id");
      await request(state, "POST", `/containers/${state.latestReservedContainerId}/pickup`);
      assert.equal(state.latestStatusCode, 200);
      state.latestContainerId = state.latestReservedContainerId;
    }
  },
  {
    pattern: /^the latest container status is "([^"]+)"$/,
    run: async (state, status) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "GET", `/containers/${state.latestContainerId}`);
      assert.equal(state.latestStatusCode, 200);
      assert.equal(latestBody<{ status: string }>(state).status, status);
    }
  },
  {
    pattern: /^I manually set the latest container status to "([^"]+)"$/,
    run: async (state, status) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "PATCH", `/containers/${state.latestContainerId}/status`, { status });
      assert.equal(state.latestStatusCode, 200);
    }
  },
  {
    pattern: /^I return the latest container$/,
    run: async (state) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "POST", `/containers/${state.latestContainerId}/return`);
      assert.equal(state.latestStatusCode, 200);
    }
  },
  {
    pattern: /^the latest container booking reference is null$/,
    run: async (state) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "GET", `/containers/${state.latestContainerId}`);
      assert.equal(state.latestStatusCode, 200);
      assert.equal(latestBody<{ bookingReference: string | null }>(state).bookingReference, null);
    }
  },
  {
    pattern: /^I release booking "([^"]+)"$/,
    run: async (state, bookingReference) => {
      await request(state, "DELETE", `/reservations/${bookingReference}`);
    }
  },
  {
    pattern: /^the latest reservation release status is "([^"]+)"$/,
    run: async (state, status) => {
      assert.equal(state.latestStatusCode, 200);
      assert.equal(latestBody<{ status: string }>(state).status, status);
    }
  },
  {
    pattern: /^the latest response status is (\d+)$/,
    run: async (state, statusCode) => {
      assert.equal(state.latestStatusCode, Number(statusCode));
    }
  },
  {
    pattern: /^the latest error contains "([^"]+)"$/,
    run: async (state, fragment) => {
      assert.match(latestBody<{ error: string }>(state).error, new RegExp(fragment));
    }
  }
];
