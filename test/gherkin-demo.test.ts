import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { loadBearerAuthConfig, Scope } from "../src/auth.js";
import {
  loadRuntimeConfig,
  STORAGE_BACKEND_ENV,
  StorageBackend,
  type RuntimeConfig
} from "../src/persistence/index.js";
import { buildServer } from "../src/server.js";
import { createStoreFromRuntimeConfig, EquipmentsStore } from "../src/store.js";
import { SERVICE_VERSION } from "../src/version.js";

const authConfig = loadBearerAuthConfig({});
const usersServiceUserId = "usr_01HV7M6J7Q3K5M8Y2V9N4A1B2C";
const usersServiceAdminScope = `${Scope.READ} ${Scope.MODIFY}`;

type JwtAuthOverrides = Partial<{
  subject: string;
  issuer: string;
  audience: string | string[];
  expiresAt: number;
  issuedAt: number;
  scope: string;
  role: string;
}>;

interface DemoState {
  app: FastifyInstance | null;
  store: EquipmentsStore | null;
  tempDir: string | null;
  runtimeConfig: RuntimeConfig | null;
  resolvedRuntimeConfig: RuntimeConfig | null;
  runtimeConfigError: string | null;
  latestStatusCode: number | null;
  latestHeaders: Record<string, string | number | string[] | undefined>;
  latestBody: unknown;
  latestBodyText: string;
  latestReservedContainerId: string | null;
  latestAssignedContainerIds: string[];
  latestContainerId: string | null;
  latestGeneratedToken: string | null;
  latestLocalUserId: string | null;
  capturedEquipmentTypeCreatorUserId: string | null;
  capturedEquipmentTypeModifierUserId: string | null;
  capturedReservationUserId: string | null;
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
    store: null,
    tempDir: null,
    runtimeConfig: null,
    resolvedRuntimeConfig: null,
    runtimeConfigError: null,
    latestStatusCode: null,
    latestHeaders: {},
    latestBody: null,
    latestBodyText: "",
    latestReservedContainerId: null,
    latestAssignedContainerIds: [],
    latestContainerId: null,
    latestGeneratedToken: null,
    latestLocalUserId: null,
    capturedEquipmentTypeCreatorUserId: null,
    capturedEquipmentTypeModifierUserId: null,
    capturedReservationUserId: null
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

function authHeader(scopes: string[], overrides: JwtAuthOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: {
    sub: string;
    iss: string;
    aud: string | string[];
    exp: number;
    iat?: number;
    scope: string;
    role?: string;
  } = {
    sub: overrides.subject ?? "demo-client",
    iss: overrides.issuer ?? authConfig.issuer,
    aud: overrides.audience ?? authConfig.audience,
    exp: overrides.expiresAt ?? now + 3600,
    scope: overrides.scope ?? scopes.join(" ")
  };
  if (overrides.issuedAt !== undefined) {
    payload.iat = overrides.issuedAt;
  }
  if (overrides.role !== undefined) {
    payload.role = overrides.role;
  }
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

function usersServiceAdminAuthHeader(overrides: JwtAuthOverrides = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return authHeader([], {
    subject: usersServiceUserId,
    issuedAt,
    expiresAt: issuedAt + 3600,
    scope: usersServiceAdminScope,
    role: "admin",
    ...overrides
  });
}

function withInvalidSignature(headers: { authorization: string }) {
  const token = headers.authorization.replace(/^Bearer\s+/i, "");
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  assert.ok(encodedHeader && encodedPayload && encodedSignature, "test token should be a JWT");

  const replacement = encodedSignature.startsWith("A") ? "B" : "A";
  const tamperedSignature = `${replacement}${encodedSignature.slice(1)}`;
  assert.notDeepEqual(
    Buffer.from(tamperedSignature, "base64url"),
    Buffer.from(encodedSignature, "base64url"),
    "test token should have different signature bytes"
  );
  return { authorization: `Bearer ${encodedHeader}.${encodedPayload}.${tamperedSignature}` };
}

function authHeaderWithCallerMetadata(scopes: string[], subject: string) {
  return {
    ...authHeader(scopes, { subject }),
    "x-auth-issuer": authConfig.issuer,
    "x-auth-subject": subject
  };
}

function partialCallerMetadataHeaders(headers: Record<string, string>) {
  return {
    ...authHeader([Scope.MODIFY]),
    ...headers
  };
}

function latestBody<T>(state: DemoState): T {
  return state.latestBody as T;
}

async function replaceService(
  state: DemoState,
  store: EquipmentsStore,
  runtimeConfig: RuntimeConfig | undefined,
  devMode?: boolean
): Promise<void> {
  await state.app?.close();
  state.store = store;
  state.runtimeConfig = runtimeConfig ?? null;
  state.app = buildServer(store, runtimeConfig, devMode, authConfig);
}

async function startServiceFromRuntimeConfig(state: DemoState, runtimeConfig: RuntimeConfig, seed: boolean): Promise<void> {
  await replaceService(state, createStoreFromRuntimeConfig(runtimeConfig, seed), runtimeConfig);
}

function captureRuntimeConfig(state: DemoState, env: Record<string, string | undefined>): void {
  state.resolvedRuntimeConfig = null;
  state.runtimeConfigError = null;

  try {
    state.resolvedRuntimeConfig = loadRuntimeConfig(env);
  } catch (error) {
    state.runtimeConfigError = error instanceof Error ? error.message : String(error);
  }
}

async function reserveContainers(
  state: DemoState,
  quantity: string,
  type: string,
  originDepot: string,
  bookingReference: string
): Promise<void> {
  await request(state, "POST", "/reservations", {
    bookingReference,
    originDepot,
    equipment: [{ type, quantity: Number(quantity) }]
  });
  if (state.latestStatusCode === 201) {
    const body = latestBody<{ assignedContainers: Array<{ containerId: string }> }>(state);
    state.latestAssignedContainerIds = body.assignedContainers.map((container) => container.containerId);
    state.latestReservedContainerId = state.latestAssignedContainerIds[0] ?? null;
    state.latestContainerId = state.latestReservedContainerId;
  }
}

const stepDefinitions: StepDefinition[] = [
  {
    pattern: /^the equipments service starts from an empty sqlite database$/,
    run: async (state) => {
      state.tempDir = mkdtempSync(join(tmpdir(), "equipments-gherkin-"));
      const path = join(state.tempDir, "demo.sqlite");
      await startServiceFromRuntimeConfig(state, { backend: StorageBackend.SQLITE, path, sqliteEmptyOnFirstBoot: true }, true);
    }
  },
  {
    pattern: /^the equipments service is running with memory persistence and no seeded data$/,
    run: async (state) => {
      await startServiceFromRuntimeConfig(
        state,
        { backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false },
        false
      );
    }
  },
  {
    pattern: /^I restart the service with the same runtime storage and no seeded data$/,
    run: async (state) => {
      assert.ok(state.runtimeConfig, "expected a runtime storage configuration");
      await startServiceFromRuntimeConfig(state, state.runtimeConfig, false);
    }
  },
  {
    pattern: /^no persistence environment is configured$/,
    run: async (state) => {
      captureRuntimeConfig(state, {});
    }
  },
  {
    pattern: /^runtime storage environment requests "([^"]+)" without (?:a persistence path|a connection string)$/,
    run: async (state, backend) => {
      captureRuntimeConfig(state, { [STORAGE_BACKEND_ENV]: backend });
    }
  },
  {
    pattern: /^runtime storage uses "([^"]+)" with no persistent path$/,
    run: async (state, backend) => {
      assert.equal(state.runtimeConfigError, null);
      assert.ok(state.resolvedRuntimeConfig, "expected runtime storage configuration");
      assert.equal(state.resolvedRuntimeConfig.backend, backend);
      assert.equal(state.resolvedRuntimeConfig.path, "");
    }
  },
  {
    pattern: /^runtime storage configuration fails with "([^"]+)"$/,
    run: async (state, fragment) => {
      assert.match(state.runtimeConfigError ?? "", new RegExp(fragment));
    }
  },
  {
    pattern: /^the seeded equipments service is running$/,
    run: async (state) => {
      await replaceService(state, new EquipmentsStore(true), undefined);
    }
  },
  {
    pattern: /^the seeded equipments service is running outside development mode$/,
    run: async (state) => {
      await replaceService(state, new EquipmentsStore(true), undefined, false);
    }
  },
  {
    pattern: /^the seeded equipments service is running with sqlite persistence at path "([^"]+)"$/,
    run: async (state, path) => {
      await replaceService(state, new EquipmentsStore(true), { backend: StorageBackend.SQLITE, path });
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
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, usersServiceAdminAuthHeader());
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a Users Service admin bearer token without required scope$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, usersServiceAdminAuthHeader({ scope: "", role: undefined }));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a Users Service admin bearer token for audience "([^"]+)"$/,
    run: async (state, method, url, audience) => {
      await requestWithHeaders(state, method, url, usersServiceAdminAuthHeader({ audience }));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a Users Service admin bearer token from issuer "([^"]+)"$/,
    run: async (state, method, url, issuer) => {
      await requestWithHeaders(state, method, url, usersServiceAdminAuthHeader({ issuer }));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with an expired Users Service admin bearer token$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, usersServiceAdminAuthHeader({
        expiresAt: Math.floor(Date.now() / 1000) - 60
      }));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a Users Service admin bearer token that has an invalid signature$/,
    run: async (state, method, url) => {
      await requestWithHeaders(state, method, url, withInvalidSignature(usersServiceAdminAuthHeader()));
    }
  },
  {
    pattern: /^I request (GET|POST|PUT|PATCH|DELETE) "([^"]+)" with a bearer token role "([^"]+)" and no equipment scopes$/,
    run: async (state, method, url, role) => {
      await requestWithHeaders(state, method, url, authHeader([], { role }));
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
    pattern: /^I generate a development admin bearer token for subject "([^"]+)"$/,
    run: async (state, subject) => {
      await requestWithHeaders(state, "POST", "/dev/generate-token", undefined, {
        subject,
        scopes: [],
        role: "admin",
        expiresInMinutes: 60
      });
      if (state.latestStatusCode === 201) {
        state.latestGeneratedToken = latestBody<{ token: string }>(state).token;
      }
    }
  },
  {
    pattern: /^I try to generate a development bearer token with a blank subject$/,
    run: async (state) => {
      await requestWithHeaders(state, "POST", "/dev/generate-token", undefined, {
        subject: "",
        scopes: [],
        expiresInMinutes: 0
      });
    }
  },
  {
    pattern: /^I create equipment type "([^"]+)" described as "([^"]+)" with nominal length "([^"]+)" and max payload (\d+) with the latest generated bearer token$/,
    run: async (state, code, description, nominalLength, maxPayloadKg) => {
      assert.ok(state.latestGeneratedToken, "expected a generated bearer token");
      await requestWithHeaders(state, "POST", "/equipment-types", { authorization: `Bearer ${state.latestGeneratedToken}` }, {
        code,
        description,
        nominalLength,
        maxPayloadKg: Number(maxPayloadKg)
      });
    }
  },
  {
    pattern: /^the latest JSON response has field "([^"]+)" equal to the service version$/,
    run: async (state, field) => {
      assert.equal(latestBody<Record<string, unknown>>(state)[field], SERVICE_VERSION);
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
    pattern: /^the latest JSON response has string array field "([^"]+)" containing exactly "([^"]+)"$/,
    run: async (state, field, value) => {
      assert.deepEqual(latestBody<Record<string, unknown>>(state)[field], [value]);
    }
  },
  {
    pattern: /^the latest JSON response has empty array field "([^"]+)"$/,
    run: async (state, field) => {
      assert.deepEqual(latestBody<Record<string, unknown>>(state)[field], []);
    }
  },
  {
    pattern: /^the latest OpenAPI response title is "([^"]+)"$/,
    run: async (state, title) => {
      assert.equal(latestBody<{ info: { title: string } }>(state).info.title, title);
    }
  },
  {
    pattern: /^the latest OpenAPI response exposes path "([^"]+)"$/,
    run: async (state, path) => {
      assert.ok(latestBody<{ paths: Record<string, unknown> }>(state).paths[path], `expected OpenAPI path ${path}`);
    }
  },
  {
    pattern: /^the latest OpenAPI bearerAuth security scheme has type "([^"]+)" and scheme "([^"]+)"$/,
    run: async (state, type, scheme) => {
      const bearerAuth = latestBody<{
        components: { securitySchemes: { bearerAuth: { type: string; scheme: string } } };
      }>(state).components.securitySchemes.bearerAuth;
      assert.equal(bearerAuth.type, type);
      assert.equal(bearerAuth.scheme, scheme);
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
    pattern: /^the latest response body does not contain "([^"]+)"$/,
    run: async (state, fragment) => {
      assert.equal(state.latestBodyText.includes(fragment), false, `expected response body not to contain ${fragment}`);
    }
  },
  {
    pattern: /^the latest playground script handles admin token rights$/,
    run: async (state) => {
      assert.ok(state.latestBodyText.includes('case "admin"'), "expected playground script to handle admin token rights");
    }
  },
  {
    pattern: /^the latest playground script loads the availability preset by default$/,
    run: async (state) => {
      assert.ok(
        state.latestBodyText.includes('loadPreset("availability")'),
        "expected playground script to load the availability preset by default"
      );
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
    pattern: /^I create equipment type "([^"]+)" described as "([^"]+)" with nominal length "([^"]+)" and max payload (\d+) with a Users Service admin bearer token$/,
    run: async (state, code, description, nominalLength, maxPayloadKg) => {
      await requestWithHeaders(state, "POST", "/equipment-types", usersServiceAdminAuthHeader(), {
        code,
        description,
        nominalLength,
        maxPayloadKg: Number(maxPayloadKg)
      });
    }
  },
  {
    pattern: /^I create equipment type "([^"]+)" described as "([^"]+)" with nominal length "([^"]+)" and max payload (\d+) as caller "([^"]+)"$/,
    run: async (state, code, description, nominalLength, maxPayloadKg, subject) => {
      await requestWithHeaders(state, "POST", "/equipment-types", authHeaderWithCallerMetadata([Scope.MODIFY], subject), {
        code,
        description,
        nominalLength,
        maxPayloadKg: Number(maxPayloadKg)
      });
      assert.equal(state.latestStatusCode, 201);
    }
  },
  {
    pattern: /^I try to create equipment type "([^"]+)" described as "([^"]+)" with nominal length "([^"]+)" and max payload (\d+) with only x-auth-(issuer|subject) caller metadata$/,
    run: async (state, code, description, nominalLength, maxPayloadKg, metadataHeader) => {
      const headers = metadataHeader === "issuer"
        ? partialCallerMetadataHeaders({ "x-auth-issuer": authConfig.issuer })
        : partialCallerMetadataHeaders({ "x-auth-subject": "ops-partial" });
      await requestWithHeaders(state, "POST", "/equipment-types", headers, {
        code,
        description,
        nominalLength,
        maxPayloadKg: Number(maxPayloadKg)
      });
    }
  },
  {
    pattern: /^I try to create equipment type "([^"]+)" described as "([^"]+)" with nominal length "([^"]+)" and max payload (\d+)$/,
    run: async (state, code, description, nominalLength, maxPayloadKg) => {
      await request(state, "POST", "/equipment-types", {
        code,
        description,
        nominalLength,
        maxPayloadKg: Number(maxPayloadKg)
      });
    }
  },
  {
    pattern: /^I update equipment type "([^"]+)" description to "([^"]+)"$/,
    run: async (state, code, description) => {
      await request(state, "PUT", `/equipment-types/${encodeURIComponent(code)}`, { description });
      assert.equal(state.latestStatusCode, 200);
    }
  },
  {
    pattern: /^I update equipment type "([^"]+)" description to "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, code, description) => {
      await requestWithHeaders(state, "PUT", `/equipment-types/${encodeURIComponent(code)}`, usersServiceAdminAuthHeader(), { description });
    }
  },
  {
    pattern: /^I update equipment type "([^"]+)" description to "([^"]+)" as caller "([^"]+)"$/,
    run: async (state, code, description, subject) => {
      await requestWithHeaders(
        state,
        "PUT",
        `/equipment-types/${encodeURIComponent(code)}`,
        authHeaderWithCallerMetadata([Scope.MODIFY], subject),
        { description }
      );
    }
  },
  {
    pattern: /^I try to update equipment type "([^"]+)" description to "([^"]+)"$/,
    run: async (state, code, description) => {
      await request(state, "PUT", `/equipment-types/${encodeURIComponent(code)}`, { description });
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
    pattern: /^the equipment type catalog includes "([^"]+)" described as "([^"]+)"$/,
    run: async (state, code, description) => {
      await request(state, "GET", "/equipment-types");
      assert.equal(state.latestStatusCode, 200);
      const item = latestBody<{ equipmentTypes: Array<{ code: string; description: string }> }>(state)
        .equipmentTypes.find((entry) => entry.code === code);
      assert.ok(item, `expected equipment type ${code}`);
      assert.equal(item.description, description);
    }
  },
  {
    pattern: /^the equipment type catalog does not include "([^"]+)"$/,
    run: async (state, code) => {
      await request(state, "GET", "/equipment-types");
      assert.equal(state.latestStatusCode, 200);
      const item = latestBody<{ equipmentTypes: Array<{ code: string }> }>(state)
        .equipmentTypes.find((entry) => entry.code === code);
      assert.equal(item, undefined);
    }
  },
  {
    pattern: /^the latest JSON response has persisted local user metadata$/,
    run: async (state) => {
      const body = latestBody<{ createdByUserId: string | null; lastModifiedByUserId: string | null }>(state);
      assert.ok(body.createdByUserId, "expected createdByUserId to be present");
      assert.equal(body.lastModifiedByUserId, body.createdByUserId);
      state.latestLocalUserId = body.createdByUserId;
    }
  },
  {
    pattern: /^equipment type "([^"]+)" still has the same local user metadata$/,
    run: async (state, code) => {
      assert.ok(state.latestLocalUserId, "expected a captured local user id");
      await request(state, "GET", "/equipment-types");
      assert.equal(state.latestStatusCode, 200);
      const item = latestBody<{
        equipmentTypes: Array<{ code: string; createdByUserId: string | null; lastModifiedByUserId: string | null }>;
      }>(state).equipmentTypes.find((entry) => entry.code === code);
      assert.ok(item, `expected equipment type ${code}`);
      assert.equal(item.createdByUserId, state.latestLocalUserId);
      assert.equal(item.lastModifiedByUserId, state.latestLocalUserId);
    }
  },
  {
    pattern: /^the latest equipment type list includes "([^"]+)"$/,
    run: async (state, code) => {
      const item = latestBody<{ equipmentTypes: Array<{ code: string }> }>(state)
        .equipmentTypes.find((entry) => entry.code === code);
      assert.ok(item, `expected latest equipment type list to include ${code}`);
    }
  },
  {
    pattern: /^the latest equipment type response has created and modified local user metadata for one caller$/,
    run: async (state) => {
      const body = latestBody<{ createdByUserId: string | null; lastModifiedByUserId: string | null }>(state);
      assert.match(body.createdByUserId ?? "", /^usr-/);
      assert.equal(body.lastModifiedByUserId, body.createdByUserId);
      state.capturedEquipmentTypeCreatorUserId = body.createdByUserId;
      state.capturedEquipmentTypeModifierUserId = body.lastModifiedByUserId;
    }
  },
  {
    pattern: /^the latest equipment type response preserves creator metadata and records a new modifier$/,
    run: async (state) => {
      assert.ok(state.capturedEquipmentTypeCreatorUserId, "expected captured creator user id");
      assert.ok(state.capturedEquipmentTypeModifierUserId, "expected captured modifier user id");
      const body = latestBody<{ createdByUserId: string | null; lastModifiedByUserId: string | null }>(state);
      assert.equal(body.createdByUserId, state.capturedEquipmentTypeCreatorUserId);
      assert.match(body.lastModifiedByUserId ?? "", /^usr-/);
      assert.notEqual(body.lastModifiedByUserId, state.capturedEquipmentTypeModifierUserId);
      state.capturedEquipmentTypeModifierUserId = body.lastModifiedByUserId;
    }
  },
  {
    pattern: /^the runtime audit log contains a successful "([^"]+)" event for "([^"]+)"$/,
    run: async (state, action, resourceId) => {
      assert.ok(state.store, "expected access to the runtime store");
      const event = state.store.listAuditEvents().find((candidate) => (
        candidate.action === action &&
        candidate.resourceId === resourceId &&
        candidate.outcome === "success"
      ));
      assert.ok(event, `expected successful audit event ${action} for ${resourceId}`);
    }
  },
  {
    pattern: /^the runtime audit log is empty$/,
    run: async (state) => {
      assert.ok(state.store, "expected access to the runtime store");
      assert.deepEqual(state.store.listAuditEvents(), []);
    }
  },
  {
    pattern: /^I register container "([^"]+)" of type "([^"]+)" at depot "([^"]+)"$/,
    run: async (state, containerNumber, equipmentType, currentDepot) => {
      await request(state, "POST", "/containers", { containerNumber, equipmentType, currentDepot });
      assert.equal(state.latestStatusCode, 201);
      state.latestContainerId = latestBody<{ id: string }>(state).id;
    }
  },
  {
    pattern: /^I register container "([^"]+)" of type "([^"]+)" at depot "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, containerNumber, equipmentType, currentDepot) => {
      await requestWithHeaders(state, "POST", "/containers", usersServiceAdminAuthHeader(), {
        containerNumber,
        equipmentType,
        currentDepot
      });
      if (state.latestStatusCode === 201) {
        state.latestContainerId = latestBody<{ id: string }>(state).id;
      }
    }
  },
  {
    pattern: /^I try to register container "([^"]+)" of type "([^"]+)" at depot "([^"]+)"$/,
    run: async (state, containerNumber, equipmentType, currentDepot) => {
      await request(state, "POST", "/containers", { containerNumber, equipmentType, currentDepot });
      if (state.latestStatusCode === 201) {
        state.latestContainerId = latestBody<{ id: string }>(state).id;
      }
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
    pattern: /^I list containers with type "([^"]+)" status "([^"]+)" depot "([^"]+)"$/,
    run: async (state, type, status, depot) => {
      const query = new URLSearchParams({ type, status, depot });
      await request(state, "GET", `/containers?${query.toString()}`);
    }
  },
  {
    pattern: /^I list containers with type "([^"]+)" status "([^"]+)" depot "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, type, status, depot) => {
      const query = new URLSearchParams({ type, status, depot });
      await requestWithHeaders(state, "GET", `/containers?${query.toString()}`, usersServiceAdminAuthHeader());
    }
  },
  {
    pattern: /^the latest container list includes container "([^"]+)"$/,
    run: async (state, containerNumber) => {
      const containers = latestBody<{ containers: Array<{ containerNumber: string }> }>(state).containers;
      assert.ok(containers.some((container) => container.containerNumber === containerNumber), `expected container ${containerNumber}`);
    }
  },
  {
    pattern: /^I fetch the latest container$/,
    run: async (state) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "GET", `/containers/${state.latestContainerId}`);
    }
  },
  {
    pattern: /^I fetch the latest container with a Users Service admin bearer token$/,
    run: async (state) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await requestWithHeaders(state, "GET", `/containers/${state.latestContainerId}`, usersServiceAdminAuthHeader());
    }
  },
  {
    pattern: /^I fetch container "([^"]+)"$/,
    run: async (state, containerId) => {
      await request(state, "GET", `/containers/${containerId}`);
    }
  },
  {
    pattern: /^I try to set container "([^"]+)" status to "([^"]+)"$/,
    run: async (state, containerId, status) => {
      await request(state, "PATCH", `/containers/${containerId}/status`, { status });
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
    pattern: /^the latest availability response includes (\d+) units of "([^"]+)" at depot "([^"]+)"$/,
    run: async (state, count, equipmentType, depotCode) => {
      const item = latestBody<{ availability: Array<{ equipmentType: string; availableCount: number; depotCode: string }> }>(state)
        .availability.find((entry) => entry.equipmentType === equipmentType && entry.depotCode === depotCode);
      assert.ok(item, `expected latest availability response for ${equipmentType} at ${depotCode}`);
      assert.equal(item.availableCount, Number(count));
    }
  },
  {
    pattern: /^I reserve (\d+) units of "([^"]+)" at depot "([^"]+)" for booking "([^"]+)"$/,
    run: async (state, quantity, type, originDepot, bookingReference) => {
      await reserveContainers(state, quantity, type, originDepot, bookingReference);
      assert.equal(state.latestStatusCode, 201);
    }
  },
  {
    pattern: /^I reserve (\d+) units of "([^"]+)" at depot "([^"]+)" for booking "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, quantity, type, originDepot, bookingReference) => {
      await requestWithHeaders(state, "POST", "/reservations", usersServiceAdminAuthHeader(), {
        bookingReference,
        originDepot,
        equipment: [{ type, quantity: Number(quantity) }]
      });
      if (state.latestStatusCode === 201) {
        const body = latestBody<{ assignedContainers: Array<{ containerId: string }> }>(state);
        state.latestAssignedContainerIds = body.assignedContainers.map((container) => container.containerId);
        state.latestReservedContainerId = state.latestAssignedContainerIds[0] ?? null;
        state.latestContainerId = state.latestReservedContainerId;
      }
    }
  },
  {
    pattern: /^I reserve (\d+) units of "([^"]+)" at depot "([^"]+)" for booking "([^"]+)" as caller "([^"]+)"$/,
    run: async (state, quantity, type, originDepot, bookingReference, subject) => {
      await requestWithHeaders(state, "POST", "/reservations", authHeaderWithCallerMetadata([Scope.MODIFY], subject), {
        bookingReference,
        originDepot,
        equipment: [{ type, quantity: Number(quantity) }]
      });
      if (state.latestStatusCode === 201) {
        const body = latestBody<{ assignedContainers: Array<{ containerId: string }> }>(state);
        state.latestAssignedContainerIds = body.assignedContainers.map((container) => container.containerId);
        state.latestReservedContainerId = state.latestAssignedContainerIds[0] ?? null;
        state.latestContainerId = state.latestReservedContainerId;
      }
    }
  },
  {
    pattern: /^I try to reserve (\d+) units of "([^"]+)" at depot "([^"]+)" for booking "([^"]+)"$/,
    run: async (state, quantity, type, originDepot, bookingReference) => {
      await reserveContainers(state, quantity, type, originDepot, bookingReference);
    }
  },
  {
    pattern: /^the latest reservation has an assigned container$/,
    run: async (state) => {
      assert.ok(state.latestReservedContainerId, "expected latest reservation to assign a container");
    }
  },
  {
    pattern: /^the latest reservation assigned (\d+) containers$/,
    run: async (state, count) => {
      assert.equal(state.latestAssignedContainerIds.length, Number(count));
    }
  },
  {
    pattern: /^the latest reservation status is "([^"]+)"$/,
    run: async (state, status) => {
      assert.equal(latestBody<{ status: string }>(state).status, status);
    }
  },
  {
    pattern: /^the latest reservation response has local user metadata for one caller$/,
    run: async (state) => {
      const body = latestBody<{ createdByUserId: string | null; lastModifiedByUserId: string | null }>(state);
      assert.match(body.createdByUserId ?? "", /^usr-/);
      assert.equal(body.lastModifiedByUserId, body.createdByUserId);
      state.capturedReservationUserId = body.createdByUserId;
    }
  },
  {
    pattern: /^all containers assigned to the latest reservation have status "([^"]+)"$/,
    run: async (state, status) => {
      assert.notEqual(state.latestAssignedContainerIds.length, 0, "expected assigned containers");
      for (const containerId of state.latestAssignedContainerIds) {
        await request(state, "GET", `/containers/${containerId}`);
        assert.equal(state.latestStatusCode, 200);
        assert.equal(latestBody<{ status: string }>(state).status, status);
      }
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
    pattern: /^I try to pick up the latest reserved container$/,
    run: async (state) => {
      assert.ok(state.latestReservedContainerId, "expected a reserved container id");
      await request(state, "POST", `/containers/${state.latestReservedContainerId}/pickup`);
      state.latestContainerId = state.latestReservedContainerId;
    }
  },
  {
    pattern: /^I pick up the latest reserved container with a Users Service admin bearer token$/,
    run: async (state) => {
      assert.ok(state.latestReservedContainerId, "expected a reserved container id");
      await requestWithHeaders(state, "POST", `/containers/${state.latestReservedContainerId}/pickup`, usersServiceAdminAuthHeader());
      if (state.latestStatusCode === 200) {
        state.latestContainerId = state.latestReservedContainerId;
      }
    }
  },
  {
    pattern: /^I pick up the latest reserved container as caller "([^"]+)"$/,
    run: async (state, subject) => {
      assert.ok(state.latestReservedContainerId, "expected a reserved container id");
      await requestWithHeaders(
        state,
        "POST",
        `/containers/${state.latestReservedContainerId}/pickup`,
        authHeaderWithCallerMetadata([Scope.MODIFY], subject)
      );
      if (state.latestStatusCode === 200) {
        state.latestContainerId = state.latestReservedContainerId;
      }
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
    pattern: /^I manually set the latest container status to "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, status) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await requestWithHeaders(state, "PATCH", `/containers/${state.latestContainerId}/status`, usersServiceAdminAuthHeader(), { status });
    }
  },
  {
    pattern: /^I try to manually set the latest container status to "([^"]+)"$/,
    run: async (state, status) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "PATCH", `/containers/${state.latestContainerId}/status`, { status });
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
    pattern: /^I return the latest container with a Users Service admin bearer token$/,
    run: async (state) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await requestWithHeaders(state, "POST", `/containers/${state.latestContainerId}/return`, usersServiceAdminAuthHeader());
    }
  },
  {
    pattern: /^I try to return the latest container$/,
    run: async (state) => {
      assert.ok(state.latestContainerId, "expected a latest container id");
      await request(state, "POST", `/containers/${state.latestContainerId}/return`);
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
    pattern: /^I release booking "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, bookingReference) => {
      await requestWithHeaders(state, "DELETE", `/reservations/${bookingReference}`, usersServiceAdminAuthHeader());
    }
  },
  {
    pattern: /^I receive a "([^"]+)" event for booking "([^"]+)"$/,
    run: async (state, eventType, bookingReference) => {
      await request(state, "POST", "/events", {
        eventType,
        payload: { bookingReference }
      });
    }
  },
  {
    pattern: /^I receive a "([^"]+)" event for booking "([^"]+)" with a Users Service admin bearer token$/,
    run: async (state, eventType, bookingReference) => {
      await requestWithHeaders(state, "POST", "/events", usersServiceAdminAuthHeader(), {
        eventType,
        payload: { bookingReference }
      });
    }
  },
  {
    pattern: /^the latest container response last modified user matches the reservation local user$/,
    run: async (state) => {
      assert.ok(state.capturedReservationUserId, "expected captured reservation user id");
      const body = latestBody<{ lastModifiedByUserId: string | null }>(state);
      assert.equal(body.lastModifiedByUserId, state.capturedReservationUserId);
    }
  },
  {
    pattern: /^the latest container response has no creator and the same local last modifier$/,
    run: async (state) => {
      assert.ok(state.capturedReservationUserId, "expected captured reservation user id");
      const body = latestBody<{ createdByUserId: string | null; lastModifiedByUserId: string | null }>(state);
      assert.equal(body.createdByUserId, null);
      assert.equal(body.lastModifiedByUserId, state.capturedReservationUserId);
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
  },
  {
    pattern: /^the latest error is "([^"]+)"$/,
    run: async (state, error) => {
      assert.equal(latestBody<{ error: string }>(state).error, error);
    }
  }
];
