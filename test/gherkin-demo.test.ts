import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { loadBearerAuthConfig, Scope } from "../src/auth.js";
import { StorageBackend } from "../src/persistence/index.js";
import { buildServer } from "../src/server.js";
import { createStoreFromRuntimeConfig, EquipmentsStore } from "../src/store.js";

const authConfig = loadBearerAuthConfig({});

interface DemoState {
  app: FastifyInstance | null;
  tempDir: string | null;
  latestStatusCode: number | null;
  latestHeaders: Record<string, string | number | string[] | undefined>;
  latestBody: unknown;
  latestBodyText: string;
  latestReservedContainerId: string | null;
  latestContainerId: string | null;
  latestGeneratedToken: string | null;
}

interface FeatureDocument {
  filePath: string;
  name: string;
  backgroundSteps: FeatureStep[];
  scenarios: FeatureScenario[];
}

interface FeatureScenario {
  name: string;
  lineNumber: number;
  steps: FeatureStep[];
}

interface FeatureStep {
  keyword: string;
  text: string;
  lineNumber: number;
}

interface StepDefinition {
  pattern: RegExp;
  run: (state: DemoState, ...captures: string[]) => Promise<void>;
}

const featureDirectory = join(import.meta.dirname, "features");
const featureDocuments = loadFeatureDocuments(featureDirectory);

for (const feature of featureDocuments) {
  for (const scenario of feature.scenarios) {
    test(`${feature.name}: ${scenario.name}`, async (t) => {
      const state = createDemoState();

      t.after(async () => {
        await state.app?.close();
        if (state.tempDir) {
          rmSync(state.tempDir, { recursive: true, force: true });
        }
      });

      for (const step of [...feature.backgroundSteps, ...scenario.steps]) {
        await runStep(step, state, feature, scenario);
      }
    });
  }
}

function createDemoState(): DemoState {
  return {
    app: null,
    tempDir: null,
    latestStatusCode: null,
    latestHeaders: {},
    latestBody: null,
    latestBodyText: "",
    latestReservedContainerId: null,
    latestContainerId: null,
    latestGeneratedToken: null
  };
}

function loadFeatureDocuments(directory: string): FeatureDocument[] {
  const featureFiles = readdirSync(directory)
    .filter((entry) => entry.endsWith(".feature"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join(directory, entry));

  assert.notEqual(featureFiles.length, 0, `expected at least one .feature file in ${directory}`);

  return featureFiles.map(parseFeatureFile);
}

function parseFeatureFile(filePath: string): FeatureDocument {
  const backgroundSteps: FeatureStep[] = [];
  const scenarios: FeatureScenario[] = [];
  let featureName = basename(filePath);
  let currentScenario: FeatureScenario | null = null;
  let currentSection: "feature" | "background" | "scenario" = "feature";

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line.startsWith("@")) {
      continue;
    }

    if (line.startsWith("Feature:")) {
      featureName = line.slice("Feature:".length).trim();
      currentSection = "feature";
      continue;
    }

    if (line.startsWith("Rule:")) {
      currentSection = "feature";
      continue;
    }

    if (line.startsWith("Background:")) {
      currentScenario = null;
      currentSection = "background";
      continue;
    }

    const scenarioMatch = line.match(/^Scenario(?: Outline)?:\s*(.+)$/);
    if (scenarioMatch) {
      currentScenario = { name: scenarioMatch[1].trim(), lineNumber, steps: [] };
      scenarios.push(currentScenario);
      currentSection = "scenario";
      continue;
    }

    const stepMatch = line.match(/^(Given|When|Then|And|But)\s+(.+)$/);
    if (stepMatch) {
      const step = { keyword: stepMatch[1], text: stepMatch[2], lineNumber };
      if (currentSection === "background") {
        backgroundSteps.push(step);
      } else if (currentScenario) {
        currentScenario.steps.push(step);
      } else {
        throw new Error(`Step declared outside a Background or Scenario at ${filePath}:${lineNumber}`);
      }
      continue;
    }

    if (line.startsWith("|") || line.startsWith("Examples:") || line.startsWith('"""') || line.startsWith("```")) {
      throw new Error(`Unsupported Gherkin syntax at ${filePath}:${lineNumber}: ${line}`);
    }

    throw new Error(`Unrecognized Gherkin line at ${filePath}:${lineNumber}: ${line}`);
  }

  assert.notEqual(scenarios.length, 0, `expected at least one Scenario in ${filePath}`);
  for (const scenario of scenarios) {
    assert.notEqual(scenario.steps.length, 0, `expected Scenario "${scenario.name}" in ${filePath} to contain steps`);
  }

  return { filePath, name: featureName, backgroundSteps, scenarios };
}

async function runStep(
  step: FeatureStep,
  state: DemoState,
  feature: FeatureDocument,
  scenario: FeatureScenario
): Promise<void> {
  for (const definition of stepDefinitions) {
    const match = step.text.match(definition.pattern);
    if (!match) {
      continue;
    }

    await definition.run(state, ...match.slice(1));
    return;
  }

  throw new Error(
    [
      `No step definition matched: ${step.keyword} ${step.text}`,
      `Location: ${relative(process.cwd(), feature.filePath)}:${step.lineNumber}`,
      `Scenario: ${scenario.name} (line ${scenario.lineNumber})`,
      "Known step definitions:",
      ...stepDefinitions.map((definition) => `  - ${definition.pattern}`)
    ].join("\n")
  );
}

async function request(state: DemoState, method: string, url: string, payload?: unknown): Promise<void> {
  return requestWithHeaders(state, method, url, authHeaderForMethod(method), payload);
}

async function requestWithHeaders(
  state: DemoState,
  method: string,
  url: string,
  headers?: Record<string, string>,
  payload?: unknown
): Promise<void> {
  assert.ok(state.app, "expected demo app to be initialized");
  const response = await state.app.inject({ method, url, payload, headers } as any);
  state.latestStatusCode = response.statusCode;
  state.latestHeaders = response.headers;
  state.latestBodyText = response.body;
  if (String(response.headers["content-type"] ?? "").startsWith("application/json") && response.body) {
    state.latestBody = response.json();
  } else {
    state.latestBody = null;
  }
}

function authHeaderForMethod(method: string) {
  const scopes = ["GET", "HEAD"].includes(method.toUpperCase()) ? [Scope.READ] : [Scope.MODIFY];
  return authHeader(scopes);
}

function authHeader(scopes: string[], overrides: { role?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "demo-client",
    iss: authConfig.issuer,
    aud: authConfig.audience,
    exp: now + 3600,
    scope: scopes.join(" "),
    ...(overrides.role ? { role: overrides.role } : {})
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", authConfig.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return { authorization: `Bearer ${encodedHeader}.${encodedPayload}.${signature}` };
}

function adminBearerWithoutEquipmentScopes() {
  return authHeader([], { role: "admin" });
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
      state.app = buildServer(store, { backend: StorageBackend.SQLITE, path, sqliteEmptyOnFirstBoot: true }, undefined, authConfig);
    }
  },
  {
    pattern: /^the seeded equipments service is running$/,
    run: async (state) => {
      state.app = buildServer(new EquipmentsStore(true), undefined, undefined, authConfig);
    }
  },
  {
    pattern: /^the seeded equipments service is running outside development mode$/,
    run: async (state) => {
      state.app = buildServer(new EquipmentsStore(true), undefined, false, authConfig);
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" without a bearer token$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url);
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a read bearer token$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, authHeader([Scope.READ]));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a modify bearer token$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, authHeader([Scope.MODIFY]));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with an admin bearer token without equipment scopes$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, adminBearerWithoutEquipmentScopes());
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with the latest generated bearer token$/,
    run: async (state, method, url) => {
      assert.ok(state.latestGeneratedToken, "expected a generated bearer token");
      await requestWithHeaders(state, method, url, { authorization: `Bearer ${state.latestGeneratedToken}` });
    }
  },
  {
    pattern: /^I try to register container "([^"]+)" of type "([^"]+)" at depot "([^"]+)" with a read bearer token$/,
    run: async (state, containerNumber, equipmentType, currentDepot) => {
      await requestWithHeaders(state, "POST", "/containers", authHeader([Scope.READ]), {
        containerNumber,
        equipmentType,
        currentDepot
      });
    }
  },
  {
    pattern: /^I register container "([^"]+)" of type "([^"]+)" at depot "([^"]+)" with an admin bearer token without equipment scopes$/,
    run: async (state, containerNumber, equipmentType, currentDepot) => {
      await requestWithHeaders(state, "POST", "/containers", adminBearerWithoutEquipmentScopes(), {
        containerNumber,
        equipmentType,
        currentDepot
      });
    }
  },
  {
    pattern: /^I generate a development bearer token for subject "([^"]+)" with read scope$/,
    run: async (state, subject) => {
      await requestWithHeaders(state, "POST", "/dev/generate-token", undefined, {
        subject,
        scopes: [Scope.READ],
        expiresInMinutes: 60
      });
      if (state.latestStatusCode === 201) {
        state.latestGeneratedToken = latestBody<{ token: string }>(state).token;
      }
    }
  },
  {
    pattern: /^the latest JSON response has field "([^"]+)" equal to "([^"]+)"$/,
    run: async (state, field, value) => {
      assert.equal(latestBody<Record<string, unknown>>(state)[field], value);
    }
  },
  {
    pattern: /^the latest JSON response has boolean field "([^"]+)" equal to (true|false)$/,
    run: async (state, field, value) => {
      assert.equal(latestBody<Record<string, unknown>>(state)[field], value === "true");
    }
  },
  {
    pattern: /^the latest OpenAPI response exposes path "([^"]+)"$/,
    run: async (state, path) => {
      assert.ok(latestBody<{ paths: Record<string, unknown> }>(state).paths[path], `expected OpenAPI path ${path}`);
    }
  },
  {
    pattern: /^the latest response redirects to "([^"]+)"$/,
    run: async (state, location) => {
      assert.equal(state.latestHeaders.location, location);
    }
  },
  {
    pattern: /^the latest response content type starts with "([^"]+)"$/,
    run: async (state, contentType) => {
      assert.ok(
        String(state.latestHeaders["content-type"] ?? "").startsWith(contentType),
        `expected content type to start with ${contentType}`
      );
    }
  },
  {
    pattern: /^the latest response body contains "([^"]+)"$/,
    run: async (state, fragment) => {
      assert.ok(state.latestBodyText.includes(fragment), `expected response body to contain ${fragment}`);
    }
  },
  {
    pattern: /^the latest response includes a generated bearer token$/,
    run: async (state) => {
      assert.match(latestBody<{ token: string }>(state).token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
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
