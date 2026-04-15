import assert from "node:assert/strict";
import test from "node:test";

import { StorageBackend } from "../src/persistence.js";
import { buildServer } from "../src/server.js";
import { EquipmentsStore } from "../src/store.js";

function createApp() {
  const store = new EquipmentsStore(true);
  return buildServer(store);
}

test("GET /health returns ok", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
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
  assert.match(response.body, /Active Backend/);
  assert.match(response.body, /memory/);
  assert.match(response.body, /\/playground\/playground\.css/);
  assert.match(response.body, /\/playground\/playground\.js/);
  assert.match(response.body, /Reset All Data/);
  assert.match(response.body, /Dev-only action/);
});

test("GET /playground shows configured backend path when present", async () => {
  const app = buildServer(new EquipmentsStore(true), {
    backend: StorageBackend.SQLITE,
    path: "/tmp/equipments.sqlite"
  });
  const response = await app.inject({ method: "GET", url: "/playground" });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /sqlite/);
  assert.match(response.body, /\/tmp\/equipments\.sqlite/);
});

test("GET /playground hides reset controls outside development mode", async () => {
  const app = buildServer(new EquipmentsStore(true), undefined, false);
  const response = await app.inject({ method: "GET", url: "/playground" });

  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /Reset All Data/);
  assert.match(response.body, /unavailable outside development mode/);
});

test("GET /playground/playground.css serves the stylesheet", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/playground/playground.css" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /^text\/css/);
  assert.match(response.body, /\.backend-chip/);
});

test("GET /playground/playground.js serves the client script", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/playground/playground.js" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /^text\/javascript/);
  assert.match(response.body, /const presets =/);
  assert.match(response.body, /function resetResponseOutput\(/);
  assert.match(response.body, /function resetAllData\(/);
  assert.match(response.body, /resetResponseOutput\(\);/);
  assert.match(response.body, /loadPreset\("availability"\)/);
});

test("POST /dev/reset-all-data resets state in development mode", async () => {
  const app = createApp();

  const created = await app.inject({
    method: "POST",
    url: "/containers",
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
    payload: {
      bookingReference: "BKG-RESET-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const reset = await app.inject({ method: "POST", url: "/dev/reset-all-data" });
  assert.equal(reset.statusCode, 200);
  assert.deepEqual(reset.json(), { reset: true, seeded: true });

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01" });
  const availabilityBody = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const twenty = availabilityBody.availability.find((item) => item.equipmentType === "20FT");
  assert.ok(twenty);
  assert.equal(twenty.availableCount, 3);

  const containers = await app.inject({ method: "GET", url: "/containers" });
  const containersBody = containers.json() as { containers: Array<{ containerNumber: string }> };
  assert.equal(containersBody.containers.some((container) => container.containerNumber === "CONU9999999"), false);
});

test("POST /dev/reset-all-data is unavailable outside development mode", async () => {
  const app = buildServer(new EquipmentsStore(true), undefined, false);
  const response = await app.inject({ method: "POST", url: "/dev/reset-all-data" });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "not found" });
});

test("equipment type endpoints support list/create/update", async () => {
  const app = createApp();

  const before = await app.inject({ method: "GET", url: "/equipment-types" });
  assert.equal(before.statusCode, 200);
  const beforeBody = before.json() as { equipmentTypes: Array<{ code: string }> };
  assert.equal(beforeBody.equipmentTypes.length, 5);

  const create = await app.inject({
    method: "POST",
    url: "/equipment-types",
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
    payload: {
      description: "45-foot High Cube Updated"
    }
  });
  assert.equal(update.statusCode, 200);
  assert.equal((update.json() as { description: string }).description, "45-foot High Cube Updated");

  const after = await app.inject({ method: "GET", url: "/equipment-types" });
  const afterBody = after.json() as { equipmentTypes: Array<{ code: string }> };
  assert.equal(afterBody.equipmentTypes.length, 6);
  assert.ok(afterBody.equipmentTypes.some((item) => item.code === "45HC"));
});

test("equipment type endpoints return expected errors", async () => {
  const app = createApp();

  const duplicate = await app.inject({
    method: "POST",
    url: "/equipment-types",
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
    payload: {
      description: "nope"
    }
  });
  assert.equal(missing.statusCode, 404);
});

test("container endpoints support register/list/get/override status", async () => {
  const app = createApp();

  const created = await app.inject({
    method: "POST",
    url: "/containers",
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

  const listed = await app.inject({ method: "GET", url: "/containers?type=20FT&status=AVAILABLE&depot=NLRTM-01" });
  assert.equal(listed.statusCode, 200);
  const listedBody = listed.json() as { containers: Array<{ id: string }> };
  assert.ok(listedBody.containers.some((container) => container.id === createdBody.id));

  const fetched = await app.inject({ method: "GET", url: `/containers/${createdBody.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.equal((fetched.json() as { id: string }).id, createdBody.id);

  const override = await app.inject({
    method: "PATCH",
    url: `/containers/${createdBody.id}/status`,
    payload: {
      status: "DISPATCHED"
    }
  });
  assert.equal(override.statusCode, 200);
  assert.equal((override.json() as { status: string }).status, "DISPATCHED");
});

test("container endpoints return expected errors", async () => {
  const app = createApp();

  const unknownType = await app.inject({
    method: "POST",
    url: "/containers",
    payload: {
      containerNumber: "CONU7777777",
      equipmentType: "NOPE",
      currentDepot: "CNSHA-01"
    }
  });
  assert.equal(unknownType.statusCode, 400);

  const missing = await app.inject({ method: "GET", url: "/containers/not-a-real-id" });
  assert.equal(missing.statusCode, 404);

  const invalidStatus = await app.inject({
    method: "PATCH",
    url: "/containers/not-a-real-id/status",
    payload: {
      status: "BROKEN"
    }
  });
  assert.equal(invalidStatus.statusCode, 404);

  const created = await app.inject({
    method: "POST",
    url: "/containers",
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
    payload: {
      status: "BROKEN"
    }
  });
  assert.equal(invalidStatusOnExisting.statusCode, 400);
});

test("GET /availability returns seeded counts", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01" });
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
    payload: {
      bookingReference: "BKG-2026-00042",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 2 }]
    }
  });

  assert.equal(reserve.statusCode, 201);
  const body = reserve.json() as { assignedContainers: Array<{ containerId: string }> };
  assert.equal(body.assignedContainers.length, 2);

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01" });
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
    payload: {
      bookingReference: "BKG-OVER-ASK",
      originDepot: "CNSHA-01",
      equipment: [{ type: "40HC", quantity: 2 }]
    }
  });

  assert.equal(failed.statusCode, 409);

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01" });
  const body = availability.json() as {
    availability: Array<{ equipmentType: string; availableCount: number }>;
  };
  const hc = body.availability.find((item) => item.equipmentType === "40HC");
  assert.ok(hc);
  assert.equal(hc.availableCount, 1);
});

test("pickup and return enforce business lifecycle rules", async () => {
  const app = createApp();

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
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

  const pickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup` });
  assert.equal(pickup.statusCode, 200);
  assert.equal((pickup.json() as { status: string }).status, "DISPATCHED");

  const back = await app.inject({ method: "POST", url: `/containers/${containerId}/return` });
  assert.equal(back.statusCode, 200);
  assert.equal((back.json() as { status: string }).status, "RETURNED");

  const invalidPickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup` });
  assert.equal(invalidPickup.statusCode, 409);
});

test("booking.cancelled event releases reserved containers", async () => {
  const app = createApp();
  const reservation = await app.inject({
    method: "POST",
    url: "/reservations",
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
    payload: {
      eventType: "booking.cancelled",
      payload: {
        bookingReference: "BKG-CANCEL-1"
      }
    }
  });
  assert.equal(releaseEvent.statusCode, 200);

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01" });
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
    payload: {
      bookingReference: "BKG-DELETE-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "40FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const release = await app.inject({ method: "DELETE", url: "/reservations/BKG-DELETE-1" });
  assert.equal(release.statusCode, 200);
  assert.equal((release.json() as { status: string }).status, "RELEASED");

  const availability = await app.inject({ method: "GET", url: "/availability?depotCode=CNSHA-01" });
  const body = availability.json() as { availability: Array<{ equipmentType: string; availableCount: number }> };
  const forty = body.availability.find((item) => item.equipmentType === "40FT");
  assert.ok(forty);
  assert.equal(forty.availableCount, 2);

  const missing = await app.inject({ method: "DELETE", url: "/reservations/NO-SUCH-BOOKING" });
  assert.equal(missing.statusCode, 404);
});

test("booking.completed event returns dispatched containers", async () => {
  const app = createApp();

  const reserve = await app.inject({
    method: "POST",
    url: "/reservations",
    payload: {
      bookingReference: "BKG-COMPLETE-1",
      originDepot: "CNSHA-01",
      equipment: [{ type: "20FT", quantity: 1 }]
    }
  });
  assert.equal(reserve.statusCode, 201);

  const containerId = (reserve.json() as { assignedContainers: Array<{ containerId: string }> }).assignedContainers[0].containerId;
  const pickup = await app.inject({ method: "POST", url: `/containers/${containerId}/pickup` });
  assert.equal(pickup.statusCode, 200);

  const completeEvent = await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      eventType: "booking.completed",
      payload: {
        bookingReference: "BKG-COMPLETE-1"
      }
    }
  });
  assert.equal(completeEvent.statusCode, 200);
  assert.deepEqual(completeEvent.json(), { processed: true });

  const container = await app.inject({ method: "GET", url: `/containers/${containerId}` });
  assert.equal((container.json() as { status: string }).status, "RETURNED");

  const unknownBooking = await app.inject({
    method: "POST",
    url: "/events",
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
