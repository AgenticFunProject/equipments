import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { type BearerAuthConfig, loadBearerAuthConfig, Scope } from "../src/auth.js";
import { StorageBackend } from "../src/persistence/index.js";
import { buildServer } from "../src/server.js";
import { EquipmentsStore } from "../src/store.js";
import { SERVICE_VERSION } from "../src/version.js";

const authConfig = loadBearerAuthConfig({});

function createApp() {
  const store = new EquipmentsStore(true);
  return buildServer(store, undefined, undefined, authConfig);
}

function createStoreAndApp(seed = true) {
  const store = new EquipmentsStore(seed);
  return {
    store,
    app: buildServer(store, undefined, undefined, authConfig)
  };
}

function authHeader(scopes: string[] = [Scope.READ, Scope.MODIFY], overrides: Partial<{ sub: string; iss: string; aud: string | string[]; exp: number; scope: string }> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: overrides.sub ?? "test-client",
    iss: overrides.iss ?? authConfig.issuer,
    aud: overrides.aud ?? authConfig.audience,
    exp: overrides.exp ?? now + 3600,
    scope: overrides.scope ?? scopes.join(" ")
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", authConfig.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return { authorization: `Bearer ${encodedHeader}.${encodedPayload}.${signature}` };
}

function authHeaders(subject: string, issuer = "platform-auth") {
  return {
    ...authHeader([Scope.MODIFY]),
    "x-auth-issuer": issuer,
    "x-auth-subject": subject
  };
}

function partialActorHeaders(headers: Record<string, string>) {
  return {
    ...authHeader([Scope.MODIFY]),
    ...headers
  };
}

test("GET /health returns ok", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", version: SERVICE_VERSION });
});

test("GET /equipment-types requires a bearer token", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/equipment-types" });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "missing bearer token" });
});

test("write routes reject read-only tokens", async () => {
  const app = createApp();
  const response = await app.inject({
    method: "POST",
    url: "/containers",
    headers: authHeader([Scope.READ]),
    payload: {
      containerNumber: "CONU1111111",
      equipmentType: "20FT",
      currentDepot: "CNSHA-01"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: `missing required scope ${Scope.MODIFY}` });
});

test("write routes record successful audit events", async () => {
  const { app, store } = createStoreAndApp();
  const response = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY], { sub: "booking-service" }),
    payload: {
      bookingReference: "BKG-AUDIT-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });

  assert.equal(response.statusCode, 201);
  const events = store.listAuditEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, "booking-service");
  assert.equal(events[0].action, "reservation.create");
  assert.equal(events[0].resourceType, "reservation");
  assert.equal(events[0].resourceId, (response.json() as { reservationId: string }).reservationId);
  assert.deepEqual(events[0].requestContext, {
    bookingReference: "BKG-AUDIT-1",
    originDepot: "CNSHA-01",
    equipment: ["20FT:1"]
  });
  assert.equal(events[0].outcome, "success");
  assert.equal(events[0].errorMessage, null);
});

test("failed write routes record failed audit events", async () => {
  const { app, store } = createStoreAndApp();
  const response = await app.inject({
    method: "POST",
    url: "/equipment-types",
    headers: authHeader([Scope.MODIFY], { sub: "ops-user" }),
    payload: {
      code: "20FT",
      description: "Duplicate",
      nominalLength: "20'",
      maxPayloadKg: 1
    }
  });

  assert.equal(response.statusCode, 409);
  const events = store.listAuditEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, "ops-user");
  assert.equal(events[0].action, "equipment_type.create");
  assert.equal(events[0].resourceType, "equipment_type");
  assert.equal(events[0].resourceId, "20FT");
  assert.deepEqual(events[0].requestContext, { code: "20FT" });
  assert.equal(events[0].outcome, "failure");
  assert.match(events[0].errorMessage ?? "", /already exists/);
});

test("read routes do not emit audit events", async () => {
  const { app, store } = createStoreAndApp();
  const response = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(store.listAuditEvents(), []);
});

test("GET / redirects to the API playground", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/" });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/playground");
});

test("GET /playground serves the HTML playground", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/playground" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /^text\/html/);
  assert.match(response.body, /Equipments API Playground/);
  assert.match(response.body, /Create Reservation/);
  assert.match(response.body, /Update Equipment Type/);
  assert.match(response.body, /Get Container/);
  assert.match(response.body, /Active Backend/);
  assert.match(response.body, /Bearer token/);
  assert.match(response.body, /Generate Token/);
  assert.match(response.body, /Token subject/);
  assert.match(response.body, /equipments:read/);
  assert.match(response.body, /equipments:modify/);
  assert.match(response.body, /GET \/health/);
  assert.match(response.body, /memory/);
  assert.match(response.body, /\/playground\/playground\.css/);
  assert.match(response.body, /\/playground\/playground\.js/);
  assert.match(response.body, /Reset All Data/);
  assert.match(response.body, /Clear All Data/);
  assert.match(response.body, /Dev-only actions/);
});

test("GET /playground shows configured backend path when present", async () => {
  const app = buildServer(new EquipmentsStore(true), {
    backend: StorageBackend.SQLITE,
    path: "/tmp/equipments.sqlite"
  }, undefined, authConfig);
  const response = await app.inject({ method: "GET", url: "/playground" });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /sqlite/);
  assert.match(response.body, /\/tmp\/equipments\.sqlite/);
});

test("GET /playground hides reset controls outside development mode", async () => {
  const app = buildServer(new EquipmentsStore(true), undefined, false, authConfig);
  const response = await app.inject({ method: "GET", url: "/playground" });

  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /Reset All Data/);
  assert.doesNotMatch(response.body, /Clear All Data/);
  assert.match(response.body, /unavailable outside development mode/);
});

test("GET /playground/playground.css serves the stylesheet", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/playground/playground.css" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /^text\/css/);
  assert.match(response.body, /\.backend-chip/);
  assert.match(response.body, /\.auth-panel/);
});

test("GET /playground/playground.js serves the client script", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/playground/playground.js" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /^text\/javascript/);
  assert.match(response.body, /const presets =/);
  assert.match(response.body, /updateType:/);
  assert.match(response.body, /getContainer:/);
  assert.match(response.body, /authHint:/);
  assert.match(response.body, /const bearerTokenInput =/);
  assert.match(response.body, /const generateTokenButton =/);
  assert.match(response.body, /\/dev\/generate-token/);
  assert.match(response.body, /function generateToken\(/);
  assert.match(response.body, /function isPublicPath\(/);
  assert.match(response.body, /function resetResponseOutput\(/);
  assert.match(response.body, /function runDevDataAction\(/);
  assert.match(response.body, /function resetAllData\(/);
  assert.match(response.body, /function clearAllData\(/);
  assert.match(response.body, /resetResponseOutput\(\);/);
  assert.match(response.body, /loadPreset\("availability"\)/);
});

test("POST /dev/reset-all-data resets state in development mode", async () => {
  const app = createApp();
  const headers = authHeader([Scope.MODIFY]);

  const created = await app.inject({
    method: "POST",
    url: "/containers",
    headers,
    payload: {
      containerNumber: "CONU9999999",
      equipmentType: "20FT",
      currentDepot: "CNSHA-01"
    }
  });
  assert.equal(created.statusCode, 201);

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers,
    payload: {
      bookingReference: "BKG-RESET-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const reset = await app.inject({ method: "POST", url: "/dev/reset-all-data", headers });
  assert.equal(reset.statusCode, 200);
  assert.deepEqual(reset.json(), { reset: true, seeded: true });

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const availabilityBody = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const twenty = availabilityBody.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 3);

  const containers = await app.inject({ method: "GET", url: "/containers", headers: authHeader([Scope.READ]) });
  const containersBody = containers.json() as { containers: Array<{ containerNumber: string }> };
  assert.equal(containersBody.containers.some((container) => container.containerNumber === "CONU9999999"), false);
});

test("POST /dev/clear-all-data clears state to empty in development mode", async () => {
  const app = createApp();
  const modifyHeaders = authHeader([Scope.MODIFY]);

  const clear = await app.inject({ method: "POST", url: "/dev/clear-all-data", headers: modifyHeaders });
  assert.equal(clear.statusCode, 200);
  assert.deepEqual(clear.json(), { reset: true, seeded: false });

  const types = await app.inject({ method: "GET", url: "/equipment-types", headers: authHeader([Scope.READ]) });
  assert.deepEqual(types.json(), { equipmentTypes: [] });

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  assert.deepEqual(availability.json(), { availability: [] });

  const containers = await app.inject({ method: "GET", url: "/containers", headers: authHeader([Scope.READ]) });
  assert.deepEqual(containers.json(), { containers: [] });
});

test("POST /dev/generate-token returns a usable bearer token in development mode", async () => {
  const app = createApp();

  const generate = await app.inject({
    method: "POST",
    url: "/dev/generate-token",
    payload: {
      subject: "playground-user",
      scopes: [Scope.READ],
      expiresInMinutes: 60
    }
  });

  assert.equal(generate.statusCode, 201);
  const generatedBody = generate.json() as {
    token: string;
    subject: string;
    scopes: string[];
  };
  assert.equal(generatedBody.subject, "playground-user");
  assert.deepEqual(generatedBody.scopes, [Scope.READ]);
  assert.match(generatedBody.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const authorized = await app.inject({
    method: "GET",
    url: "/availability?depotCode=CNSHA-01",
    headers: { authorization: `Bearer ${generatedBody.token}` }
  });
  assert.equal(authorized.statusCode, 200);
});

test("POST /dev/generate-token validates required fields", async () => {
  const app = createApp();

  const response = await app.inject({
    method: "POST",
    url: "/dev/generate-token",
    payload: {
      subject: "",
      scopes: [],
      expiresInMinutes: 0
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "token subject is required" });
});

test("POST /dev/generate-token is unavailable outside development mode", async () => {
  const app = buildServer(new EquipmentsStore(true), undefined, false, authConfig);

  const response = await app.inject({
    method: "POST",
    url: "/dev/generate-token",
    payload: {
      subject: "playground-user",
      scopes: [Scope.READ],
      expiresInMinutes: 60
    }
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "not found" });
});

test("POST /dev/reset-all-data is unavailable outside development mode", async () => {
  const app = buildServer(new EquipmentsStore(true), undefined, false, authConfig);
  const response = await app.inject({ method: "POST", url: "/dev/reset-all-data", headers: authHeader([Scope.MODIFY]) });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "not found" });
});

test("POST /dev/clear-all-data is unavailable outside development mode", async () => {
  const app = buildServer(new EquipmentsStore(true), undefined, false, authConfig);
  const response = await app.inject({ method: "POST", url: "/dev/clear-all-data", headers: authHeader([Scope.MODIFY]) });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "not found" });
});

test("equipment type endpoints support list/create/update", async () => {
  const app = createApp();
  const readHeaders = authHeader([Scope.READ]);
  const modifyHeaders = authHeader([Scope.MODIFY]);

  const before = await app.inject({ method: "GET", url: "/equipment-types", headers: readHeaders });
  assert.equal(before.statusCode, 200);
  const beforeBody = before.json() as { equipmentTypes: Array<{ code: string }> };
  assert.equal(beforeBody.equipmentTypes.length, 5);

  const create = await app.inject({
    method: "POST",
    url: "/equipment-types",
    headers: modifyHeaders,
    payload: {
      code: "45HC",
      description: "45-foot High Cube",
      nominalLength: "45'",
      maxPayloadKg: 29500
    }
  });
  assert.equal(create.statusCode, 201);
  assert.equal((create.json() as { code: string }).code, "45HC");

  const update = await app.inject({
    method: "PUT",
    url: "/equipment-types/45hc",
    headers: modifyHeaders,
    payload: {
      description: "45-foot High Cube Updated"
    }
  });
  assert.equal(update.statusCode, 200);
  assert.equal((update.json() as { description: string }).description, "45-foot High Cube Updated");

  const after = await app.inject({ method: "GET", url: "/equipment-types", headers: readHeaders });
  const afterBody = after.json() as { equipmentTypes: Array<{ code: string }> };
  assert.equal(afterBody.equipmentTypes.length, 6);
  assert.ok(afterBody.equipmentTypes.some((item) => item.code === "45HC"));
});

test("write endpoints attach audit metadata from authenticated caller headers", async () => {
  const app = createApp();

  const create = await app.inject({
    method: "POST",
    url: "/equipment-types",
    headers: authHeaders("ops-create"),
    payload: {
      code: "45HC",
      description: "45-foot High Cube",
      nominalLength: "45'",
      maxPayloadKg: 29500
    }
  });
  assert.equal(create.statusCode, 201);
  const createdBody = create.json() as {
    createdByUserId: string;
    lastModifiedByUserId: string;
    createdAt: string;
    updatedAt: string;
  };
  assert.match(createdBody.createdByUserId, /^usr-/);
  assert.equal(createdBody.lastModifiedByUserId, createdBody.createdByUserId);
  assert.equal(createdBody.createdAt, createdBody.updatedAt);

  const update = await app.inject({
    method: "PUT",
    url: "/equipment-types/45HC",
    headers: authHeaders("ops-update"),
    payload: {
      description: "45-foot High Cube Updated"
    }
  });
  assert.equal(update.statusCode, 200);
  const updatedBody = update.json() as {
    createdByUserId: string;
    lastModifiedByUserId: string;
    createdAt: string;
    updatedAt: string;
  };
  assert.equal(updatedBody.createdByUserId, createdBody.createdByUserId);
  assert.notEqual(updatedBody.lastModifiedByUserId, createdBody.lastModifiedByUserId);
  assert.equal(updatedBody.createdAt, createdBody.createdAt);
  assert.notEqual(updatedBody.updatedAt, createdBody.updatedAt);
});

test("reservation and container writes reuse stable local user ids", async () => {
  const app = createApp();
  const headers = authHeaders("ops-agent");

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers,
    payload: {
      bookingReference: "BKG-AUDIT-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);
  const reservationBody = reserve.json() as {
    assignedContainers: Array<{ containerId: string }>;
    createdByUserId: string;
    lastModifiedByUserId: string;
  };
  assert.match(reservationBody.createdByUserId, /^usr-/);
  assert.equal(reservationBody.lastModifiedByUserId, reservationBody.createdByUserId);

  const containerId = reservationBody.assignedContainers[0].containerId;
  const pickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup`, headers });
  assert.equal(pickup.statusCode, 200);
  const pickupBody = pickup.json() as { createdByUserId: string | null; lastModifiedByUserId: string | null };
  assert.equal(pickupBody.lastModifiedByUserId, reservationBody.createdByUserId);

  const fetched = await app.inject({ method: "GET", url: `/containers/${containerId}`, headers: authHeader([Scope.READ]) });
  assert.equal(fetched.statusCode, 200);
  const fetchedBody = fetched.json() as { createdByUserId: string | null; lastModifiedByUserId: string | null };
  assert.equal(fetchedBody.createdByUserId, null);
  assert.equal(fetchedBody.lastModifiedByUserId, reservationBody.createdByUserId);
});

test("partial authenticated caller headers are rejected", async () => {
  const app = createApp();

  const response = await app.inject({
    method: "POST",
    url: "/equipment-types",
    headers: partialActorHeaders({ "x-auth-issuer": "platform-auth" }),
    payload: {
      code: "45HC",
      description: "45-foot High Cube",
      nominalLength: "45'",
      maxPayloadKg: 29500
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: "authenticated caller metadata requires both x-auth-issuer and x-auth-subject headers"
  });
});

test("equipment type endpoints return expected errors", async () => {
  const app = createApp();
  const modifyHeaders = authHeader([Scope.MODIFY]);

  const duplicate = await app.inject({
    method: "POST",
    url: "/equipment-types",
    headers: modifyHeaders,
    payload: {
      code: "20FT",
      description: "Duplicate",
      nominalLength: "20'",
      maxPayloadKg: 1
    }
  });
  assert.equal(duplicate.statusCode, 409);

  const missing = await app.inject({
    method: "PUT",
    url: "/equipment-types/DOES-NOT-EXIST",
    headers: modifyHeaders,
    payload: {
      description: "nope"
    }
  });
  assert.equal(missing.statusCode, 404);
});

test("container endpoints support register/list/get/override status", async () => {
  const app = createApp();
  const readHeaders = authHeader([Scope.READ]);
  const modifyHeaders = authHeader([Scope.MODIFY]);

  const created = await app.inject({
    method: "POST",
    url: "/containers",
    headers: modifyHeaders,
    payload: {
      containerNumber: "CONU8888888",
      equipmentType: "20FT",
      currentDepot: "NLRTM-01"
    }
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.json() as { id: string; status: string; currentDepot: string };
  assert.equal(createdBody.status, "AVAILABLE");
  assert.equal(createdBody.currentDepot, "NLRTM-01");

  const listed = await app.inject({ method: "GET", url: "/containers?type=20FT&status=AVAILABLE&depot=NLRTM-01", headers: readHeaders });
  assert.equal(listed.statusCode, 200);
  const listedBody = listed.json() as { containers: Array<{ id: string }> };
  assert.ok(listedBody.containers.some((container) => container.id === createdBody.id));

  const fetched = await app.inject({ method: "GET", url: `/containers/${createdBody.id}`, headers: readHeaders });
  assert.equal(fetched.statusCode, 200);
  assert.equal((fetched.json() as { id: string }).id, createdBody.id);

  const override = await app.inject({
    method: "PATCH",
    url: `/containers/${createdBody.id}/status`,
    headers: modifyHeaders,
    payload: {
      status: "DISPATCHED"
    }
  });
  assert.equal(override.statusCode, 200);
  assert.equal((override.json() as { status: string }).status, "DISPATCHED");
});

test("container endpoints return expected errors", async () => {
  const app = createApp();
  const modifyHeaders = authHeader([Scope.MODIFY]);

  const unknownType = await app.inject({
    method: "POST",
    url: "/containers",
    headers: modifyHeaders,
    payload: {
      containerNumber: "CONU7777777",
      equipmentType: "NOPE",
      currentDepot: "CNSHA-01"
    }
  });
  assert.equal(unknownType.statusCode, 400);

  const missing = await app.inject({ method: "GET", url: "/containers/not-a-real-id", headers: authHeader([Scope.READ]) });
  assert.equal(missing.statusCode, 404);

  const invalidStatus = await app.inject({
    method: "PATCH",
    url: "/containers/not-a-real-id/status",
    headers: modifyHeaders,
    payload: {
      status: "BROKEN"
    }
  });
  assert.equal(invalidStatus.statusCode, 404);

  const created = await app.inject({
    method: "POST",
    url: "/containers",
    headers: modifyHeaders,
    payload: {
      containerNumber: "CONU5555555",
      equipmentType: "20FT",
      currentDepot: "CNSHA-01"
    }
  });
  const createdBody = created.json() as { id: string };
  const invalidStatusOnExisting = await app.inject({
    method: "PATCH",
    url: `/containers/${createdBody.id}/status`,
    headers: modifyHeaders,
    payload: {
      status: "BROKEN"
    }
  });
  assert.equal(invalidStatusOnExisting.statusCode, 400);
});

test("GET /availability returns seeded counts", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  assert.equal(response.statusCode, 200);

  const body = response.json() as {
    availability: Array<{ equipmentType: string; availableCount: number; depotCode: string }>;
  };

  const twenty = body.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 3);
});

test("POST /reservations reserves containers atomically", async () => {
  const app = createApp();

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      bookingReference: "BKG-2026-00042",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 2 }]
    }
  });

  assert.equal(reserve.statusCode, 201);
  const body = reserve.json() as { assignedContainers: Array<{ containerId: string }> };
  assert.equal(body.assignedContainers.length, 2);

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const afterBody = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const twenty = afterBody.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 1);
});

test("reservation creation fails when stock insufficient and leaves inventory unchanged", async () => {
  const app = createApp();

  const failed = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      bookingReference: "BKG-OVER-ASK",
      originDepot: "CNSHA-01",
      equipment: [{ type: "40HC", quantity: 2 }]
    }
  });

  assert.equal(failed.statusCode, 409);

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const body = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const hc = body.availability.find((item) => item.equipmentType === "40HC");
  assert.ok(hc);
  assert.equal(hc.availableCount, 1);
});

test("pickup and return enforce business lifecycle rules", async () => {
  const app = createApp();
  const modifyHeaders = authHeader([Scope.MODIFY]);

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: modifyHeaders,
    payload: {
      bookingReference: "BKG-LC-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });

  const reserved = reserve.json() as {
    assignedContainers: Array<{ containerId: string }>;
  };
  const containerId = reserved.assignedContainers[0].containerId;

  const pickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup`, headers: modifyHeaders });
  assert.equal(pickup.statusCode, 200);
  assert.equal((pickup.json() as { status: string }).status, "DISPATCHED");

  const back = await app.inject({ method: "POST", url: `/containers/${containerId}/return`, headers: modifyHeaders });
  assert.equal(back.statusCode, 200);
  assert.equal((back.json() as { status: string }).status, "AVAILABLE");

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const body = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const twenty = body.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 3);

  const invalidPickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup`, headers: modifyHeaders });
  assert.equal(invalidPickup.statusCode, 409);
});

test("booking.cancelled event releases reserved containers", async () => {
  const app = createApp();
  const reservation = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      bookingReference: "BKG-CANCEL-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reservation.statusCode, 201);

  const releaseEvent = await app.inject({
    method: "POST",
    url: "/events",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      eventType: "booking.cancelled",
      payload: {
        bookingReference: "BKG-CANCEL-1"
      }
    }
  });
  assert.equal(releaseEvent.statusCode, 200);

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const body = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const twenty = body.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 3);
});

test("DELETE /reservations releases reservation by booking reference", async () => {
  const app = createApp();

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      bookingReference: "BKG-DELETE-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "40FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const release = await app.inject({ method: "DELETE", url: "/reservations/BKG-DELETE-1", headers: authHeader([Scope.MODIFY]) });
  assert.equal(release.statusCode, 200);
  assert.equal((release.json() as { status: string }).status, "RELEASED");

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const body = availability.json() as { availability: Array<{ equipmentType: string; availableCount: number }> };
  const forty = body.availability.find((item) => item.equipmentType === "40FT");
  assert.ok(forty);
  assert.equal(forty.availableCount, 2);

  const missing = await app.inject({ method: "DELETE", url: "/reservations/NO-SUCH-BOOKING", headers: authHeader([Scope.MODIFY]) });
  assert.equal(missing.statusCode, 404);
});

test("DELETE /reservations rejects release after pickup", async () => {
  const app = createApp();

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      bookingReference: "BKG-DELETE-2",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const containerId = (reserve.json() as { assignedContainers: Array<{ containerId: string }> }).assignedContainers[0].containerId;
  const pickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup`, headers: authHeader([Scope.MODIFY]) });
  assert.equal(pickup.statusCode, 200);

  const release = await app.inject({ method: "DELETE", url: "/reservations/BKG-DELETE-2", headers: authHeader([Scope.MODIFY]) });
  assert.equal(release.statusCode, 409);
  assert.match((release.json() as { error: string }).error, /cannot be released after dispatch/);

  const cancelledEvent = await app.inject({
    method: "POST",
    url: "/events",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      eventType: "booking.cancelled",
      payload: {
        bookingReference: "BKG-DELETE-2"
      }
    }
  });
  assert.equal(cancelledEvent.statusCode, 409);
  assert.match((cancelledEvent.json() as { error: string }).error, /cannot be released after dispatch/);

  const container = await app.inject({ method: "GET", url: `/containers/${containerId}`, headers: authHeader([Scope.READ]) });
  assert.equal(container.statusCode, 200);
  assert.equal((container.json() as { status: string }).status, "DISPATCHED");

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const body = availability.json() as { availability: Array<{ equipmentType: string; availableCount: number }> };
  const twenty = body.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 2);
});

test("booking.completed event returns dispatched containers", async () => {
  const app = createApp();

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      bookingReference: "BKG-COMPLETE-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const containerId = (reserve.json() as { assignedContainers: Array<{ containerId: string }> }).assignedContainers[0].containerId;
  const pickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup`, headers: authHeader([Scope.MODIFY]) });
  assert.equal(pickup.statusCode, 200);

  const completeEvent = await app.inject({
    method: "POST",
    url: "/events",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      eventType: "booking.completed",
      payload: {
        bookingReference: "BKG-COMPLETE-1"
      }
    }
  });
  assert.equal(completeEvent.statusCode, 200);
  assert.deepEqual(completeEvent.json(), { processed: true });

  const container = await app.inject({ method: "GET", url: `/containers/${containerId}`, headers: authHeader([Scope.READ]) });
  assert.equal((container.json() as { status: string }).status, "AVAILABLE");

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01", headers: authHeader([Scope.READ]) });
  const availabilityBody = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const twenty = availabilityBody.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 3);

  const unknownBooking = await app.inject({
    method: "POST",
    url: "/events",
    headers: authHeader([Scope.MODIFY]),
    payload: {
      eventType: "booking.completed",
      payload: {
        bookingReference: "BKG-NOT-FOUND"
      }
    }
  });
  assert.equal(unknownBooking.statusCode, 200);
  assert.deepEqual(unknownBooking.json(), { processed: false });
});
