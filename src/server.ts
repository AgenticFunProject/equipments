import Fastify, { type FastifyInstance } from "fastify";

import { DomainError } from "./errors.js";
import { type RuntimeConfig, StorageBackend } from "./persistence.js";
import { getPlaygroundScript, getPlaygroundStyle, renderApiPlayground } from "./playground.js";
import { EquipmentsStore } from "./store.js";

const defaultRuntimeConfig: RuntimeConfig = { backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false };
const defaultDevMode = process.env.NODE_ENV !== "production";

export function buildServer(
  store = new EquipmentsStore(),
  runtimeConfig: RuntimeConfig = defaultRuntimeConfig,
  devMode = defaultDevMode
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      reply.status(error.statusCode).send({ error: error.message });
      return;
    }

    reply.status(500).send({ error: "internal server error" });
  });

  app.get("/", async (_request, reply) => {
    reply.redirect("/playground");
  });

  app.get("/playground", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderApiPlayground(runtimeConfig, devMode));
  });

  app.get("/playground/playground.css", async (_request, reply) => {
    reply.type("text/css; charset=utf-8").send(getPlaygroundStyle());
  });

  app.get("/playground/playground.js", async (_request, reply) => {
    reply.type("text/javascript; charset=utf-8").send(getPlaygroundScript());
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/equipment-types", async () => ({ equipmentTypes: store.listEquipmentTypes() }));

  app.post("/equipment-types", async (request, reply) => {
    const created = store.createEquipmentType(request.body as any);
    reply.status(201);
    return created;
  });

  app.put("/equipment-types/:code", async (request) => {
    const params = request.params as { code: string };
    return store.updateEquipmentType(params.code, request.body as any);
  });

  app.post("/containers", async (request, reply) => {
    const created = store.registerContainer(request.body as any);
    reply.status(201);
    return created;
  });

  app.get("/containers", async (request) => {
    const query = request.query as { type?: string; status?: string; depot?: string };
    return { containers: store.listContainers(query) };
  });

  app.get("/containers/:id", async (request) => {
    const params = request.params as { id: string };
    return store.getContainer(params.id);
  });

  app.patch("/containers/:id/status", async (request) => {
    const params = request.params as { id: string };
    const body = request.body as { status: string };
    return store.overrideContainerStatus(params.id, body.status);
  });

  app.get("/availability", async (request) => {
    const query = request.query as { depotCode?: string };
    return { availability: store.getAvailability(query.depotCode) };
  });

  app.post("/reservations", async (request, reply) => {
    const result = store.createReservation(request.body as any);
    reply.status(201);
    return {
      reservationId: result.reservation.id,
      bookingReference: result.reservation.bookingReference,
      assignedContainers: result.assignedContainers,
      status: "RESERVED"
    };
  });

  app.delete("/reservations/:bookingReference", async (request) => {
    const params = request.params as { bookingReference: string };
    const reservation = store.releaseReservationByBooking(params.bookingReference);
    return {
      reservationId: reservation.id,
      bookingReference: reservation.bookingReference,
      status: reservation.status
    };
  });

  app.post("/containers/:id/pickup", async (request) => {
    const params = request.params as { id: string };
    return store.pickupContainer(params.id);
  });

  app.post("/containers/:id/return", async (request) => {
    const params = request.params as { id: string };
    return store.returnContainer(params.id);
  });

  app.post("/events", async (request) => {
    const body = request.body as { eventType: string; payload: { bookingReference: string } };
    return store.consumeEvent(body.eventType, body.payload);
  });

  app.post("/dev/reset-all-data", async (_request, reply) => {
    if (!devMode) {
      reply.status(404).send({ error: "not found" });
      return;
    }

    return store.resetAllData();
  });

  app.post("/dev/clear-all-data", async (_request, reply) => {
    if (!devMode) {
      reply.status(404).send({ error: "not found" });
      return;
    }

    return store.clearAllData();
  });

  return app;
}
