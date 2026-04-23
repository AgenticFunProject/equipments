import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { authenticateBearerToken, createBearerToken, type AuthenticatedCaller, type BearerAuthConfig, ensureScope, loadBearerAuthConfig, Scope } from "./auth.js";
import { DomainError } from "./errors.js";
import { type RuntimeConfig, StorageBackend } from "./persistence/index.js";
import { getPlaygroundScript, getPlaygroundStyle, renderApiPlayground } from "./playground.js";
import { EquipmentsStore } from "./store.js";
import { AuditOutcome, type AuditContext } from "./types.js";
import { SERVICE_VERSION } from "./version.js";

const defaultRuntimeConfig: RuntimeConfig = { backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false };
const defaultDevMode = process.env.NODE_ENV !== "production";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthenticatedCaller | null;
  }
}

function getCallerIdentity(request: FastifyRequest): { issuer: string; subject: string } | undefined {
  const issuer = readHeaderValue(request.headers["x-auth-issuer"]);
  const subject = readHeaderValue(request.headers["x-auth-subject"]);

  if (!issuer && !subject) {
    return undefined;
  }
  if (!issuer || !subject) {
    throw new DomainError("authenticated caller metadata requires both x-auth-issuer and x-auth-subject headers");
  }

  return { issuer, subject };
}

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

export function buildServer(
  store = new EquipmentsStore(),
  runtimeConfig: RuntimeConfig = defaultRuntimeConfig,
  devMode = defaultDevMode,
  authConfig: BearerAuthConfig = loadBearerAuthConfig()
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.decorateRequest("auth", null);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      reply.status(error.statusCode).send({ error: error.message });
      return;
    }

    reply.status(500).send({ error: "internal server error" });
  });

  app.addHook("preHandler", async (request) => {
    if (isPublicRoute(request.routeOptions.url ?? request.url)) {
      return;
    }

    const caller = authenticateBearerToken(request.headers.authorization, authConfig);
    ensureScope(caller, requiredScopeForMethod(request.method));
    request.auth = caller;
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

  app.get("/health", async () => ({ status: "ok", version: SERVICE_VERSION }));

  app.get("/equipment-types", async () => ({ equipmentTypes: store.listEquipmentTypes() }));

  app.post("/equipment-types", async (request, reply) => auditedWrite(store, request, {
    action: "equipment_type.create",
    resourceType: "equipment_type",
    resourceId: (request, result) => result?.code ?? ((request.body as EquipmentTypeBody).code?.trim().toUpperCase() ?? "unknown"),
    requestContext: (request) => {
      const body = request.body as EquipmentTypeBody;
      return { code: body.code?.trim().toUpperCase() ?? "" };
    }
  }, async () => {
    const created = store.createEquipmentType(request.body as any, getCallerIdentity(request));
    reply.status(201);
    return created;
  }));

  app.put("/equipment-types/:code", async (request) => auditedWrite(store, request, {
    action: "equipment_type.update",
    resourceType: "equipment_type",
    resourceId: (request, result) => result?.code ?? (request.params as { code: string }).code.trim().toUpperCase(),
    requestContext: (request) => {
      const params = request.params as { code: string };
      return { code: params.code.trim().toUpperCase() };
    }
  }, () => {
    const params = request.params as { code: string };
    return store.updateEquipmentType(params.code, request.body as any, getCallerIdentity(request));
  }));

  app.post("/containers", async (request, reply) => auditedWrite(store, request, {
    action: "container.register",
    resourceType: "container",
    resourceId: (request, result) => result?.id ?? ((request.body as RegisterContainerBody).containerNumber?.trim().toUpperCase() ?? "unknown"),
    requestContext: (request) => {
      const body = request.body as RegisterContainerBody;
      return {
        containerNumber: body.containerNumber?.trim().toUpperCase() ?? "",
        equipmentType: body.equipmentType?.trim().toUpperCase() ?? "",
        currentDepot: body.currentDepot?.trim().toUpperCase() ?? ""
      };
    }
  }, async () => {
    const created = store.registerContainer(request.body as any, getCallerIdentity(request));
    reply.status(201);
    return created;
  }));

  app.get("/containers", async (request) => {
    const query = request.query as { type?: string; status?: string; depot?: string };
    return { containers: store.listContainers(query) };
  });

  app.get("/containers/:id", async (request) => {
    const params = request.params as { id: string };
    return store.getContainer(params.id);
  });

  app.patch("/containers/:id/status", async (request) => auditedWrite(store, request, {
    action: "container.status_override",
    resourceType: "container",
    resourceId: (request) => (request.params as { id: string }).id,
    requestContext: (request) => {
      const params = request.params as { id: string };
      const body = request.body as { status?: string };
      return {
        containerId: params.id,
        status: body.status?.trim().toUpperCase() ?? ""
      };
    }
  }, () => {
    const params = request.params as { id: string };
    const body = request.body as { status: string };
    return store.overrideContainerStatus(params.id, body.status, getCallerIdentity(request));
  }));

  app.get("/availability", async (request) => {
    const query = request.query as { depotCode?: string };
    return { availability: store.getAvailability(query.depotCode) };
  });

  app.post("/reservations", async (request, reply) => auditedWrite(store, request, {
    action: "reservation.create",
    resourceType: "reservation",
    resourceId: (request, result) => result?.reservationId ?? ((request.body as ReservationBody).bookingReference?.trim() ?? "unknown"),
    requestContext: (request) => {
      const body = request.body as ReservationBody;
      return {
        bookingReference: body.bookingReference?.trim() ?? "",
        originDepot: body.originDepot?.trim().toUpperCase() ?? "",
        equipment: (body.equipment ?? []).map((item) => `${item.type.trim().toUpperCase()}:${item.quantity}`)
      };
    }
  }, async () => {
    const result = store.createReservation(request.body as any, getCallerIdentity(request));
    reply.status(201);
    return {
      reservationId: result.reservation.id,
      bookingReference: result.reservation.bookingReference,
      assignedContainers: result.assignedContainers,
      status: result.reservation.status,
      createdByUserId: result.reservation.createdByUserId,
      lastModifiedByUserId: result.reservation.lastModifiedByUserId,
      createdAt: result.reservation.createdAt,
      updatedAt: result.reservation.updatedAt
    };
  }));

  app.delete("/reservations/:bookingReference", async (request) => auditedWrite(store, request, {
    action: "reservation.release",
    resourceType: "reservation",
    resourceId: (_request, result) => result?.reservationId ?? "unknown",
    requestContext: (request) => {
      const params = request.params as { bookingReference: string };
      return { bookingReference: params.bookingReference };
    }
  }, () => {
    const params = request.params as { bookingReference: string };
    const reservation = store.releaseReservationByBooking(params.bookingReference, getCallerIdentity(request));
    return {
      reservationId: reservation.id,
      bookingReference: reservation.bookingReference,
      status: reservation.status,
      createdByUserId: reservation.createdByUserId,
      lastModifiedByUserId: reservation.lastModifiedByUserId,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt
    };
  }));

  app.post("/containers/:id/pickup", async (request) => auditedWrite(store, request, {
    action: "container.pickup",
    resourceType: "container",
    resourceId: (request) => (request.params as { id: string }).id,
    requestContext: (request) => ({ containerId: (request.params as { id: string }).id })
  }, () => {
    const params = request.params as { id: string };
    return store.pickupContainer(params.id, getCallerIdentity(request));
  }));

  app.post("/containers/:id/return", async (request) => auditedWrite(store, request, {
    action: "container.return",
    resourceType: "container",
    resourceId: (request) => (request.params as { id: string }).id,
    requestContext: (request) => ({ containerId: (request.params as { id: string }).id })
  }, () => {
    const params = request.params as { id: string };
    return store.returnContainer(params.id, getCallerIdentity(request));
  }));

  app.post("/events", async (request) => auditedWrite(store, request, {
    action: "event.consume",
    resourceType: "event",
    resourceId: (request) => (request.body as EventBody).eventType?.trim() ?? "unknown",
    requestContext: (request) => {
      const body = request.body as EventBody;
      return {
        eventType: body.eventType?.trim() ?? "",
        bookingReference: body.payload?.bookingReference?.trim() ?? ""
      };
    }
  }, () => {
    const body = request.body as { eventType: string; payload: { bookingReference: string } };
    return store.consumeEvent(body.eventType, body.payload, getCallerIdentity(request));
  }));

  app.post("/dev/reset-all-data", async (request, reply) => auditedWrite(store, request, {
    action: "store.reset_all_data",
    resourceType: "store",
    resourceId: () => "runtime-state",
    requestContext: () => ({ mode: devMode ? "development" : "production" })
  }, async () => {
    if (!devMode) {
      reply.status(404).send({ error: "not found" });
      return;
    }

    return store.resetAllData();
  }));

  app.post("/dev/clear-all-data", async (request, reply) => auditedWrite(store, request, {
    action: "store.clear_all_data",
    resourceType: "store",
    resourceId: () => "runtime-state",
    requestContext: () => ({ mode: devMode ? "development" : "production" })
  }, async () => {
    if (!devMode) {
      reply.status(404).send({ error: "not found" });
      return;
    }

    return store.clearAllData();
  }));

  app.post("/dev/generate-token", async (request, reply) => {
    if (!devMode) {
      reply.status(404).send({ error: "not found" });
      return;
    }

    const body = request.body as { subject?: string; scopes?: string[]; expiresInMinutes?: number };
    const subject = body.subject?.trim() ?? "";
    if (!subject) {
      throw new DomainError("token subject is required");
    }

    const scopes = Array.isArray(body.scopes) ? body.scopes.map((scope) => scope.trim()).filter(Boolean) : [];
    if (!scopes.length) {
      throw new DomainError("at least one token scope is required");
    }

    const expiresInMinutes = Number(body.expiresInMinutes);
    if (!Number.isFinite(expiresInMinutes) || expiresInMinutes <= 0) {
      throw new DomainError("token expiry must be a positive number of minutes");
    }

    const token = createBearerToken(authConfig, {
      subject,
      scopes,
      expiresInSeconds: Math.floor(expiresInMinutes * 60)
    });

    reply.status(201);
    return {
      token,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      subject,
      scopes,
      expiresInMinutes
    };
  });

  return app;
}

function requiredScopeForMethod(method: string): Scope {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
      return Scope.READ;
    default:
      return Scope.MODIFY;
  }
}

function isPublicRoute(url: string): boolean {
  return url === "/" || url === "/health" || url === "/playground" || url.startsWith("/playground/") || url === "/dev/generate-token";
}

interface EquipmentTypeBody {
  code?: string;
}

interface RegisterContainerBody {
  containerNumber?: string;
  equipmentType?: string;
  currentDepot?: string;
}

interface ReservationBody {
  bookingReference?: string;
  originDepot?: string;
  equipment?: Array<{ type: string; quantity: number }>;
}

interface EventBody {
  eventType?: string;
  payload?: { bookingReference?: string };
}

type AuditedRequest = FastifyRequest & { auth: AuthenticatedCaller | null };

interface AuditSpec<T> {
  action: string;
  resourceType: string;
  resourceId: (request: AuditedRequest, result?: T) => string;
  requestContext: (request: AuditedRequest, result?: T) => AuditContext;
}

async function auditedWrite<T>(
  store: EquipmentsStore,
  request: AuditedRequest,
  spec: AuditSpec<T>,
  execute: () => Promise<T> | T
): Promise<T> {
  const startedAt = new Date().toISOString();

  try {
    const result = await execute();
    if (request.auth) {
      recordAuditEvent(store, request.auth, spec, startedAt, AuditOutcome.SUCCESS, null, request, result);
    }
    return result;
  } catch (error) {
    if (request.auth) {
      recordAuditEvent(
        store,
        request.auth,
        spec,
        startedAt,
        AuditOutcome.FAILURE,
        error instanceof Error ? error.message : "unknown error",
        request
      );
    }
    throw error;
  }
}

function recordAuditEvent<T>(
  store: EquipmentsStore,
  caller: AuthenticatedCaller,
  spec: AuditSpec<T>,
  timestamp: string,
  outcome: AuditOutcome,
  errorMessage: string | null,
  request: AuditedRequest,
  result?: T
): void {
  store.recordAuditEvent({
    actor: caller.subject,
    action: spec.action,
    resourceType: spec.resourceType,
    resourceId: spec.resourceId(request, result),
    timestamp,
    requestContext: spec.requestContext(request, result),
    outcome,
    errorMessage
  });
}
