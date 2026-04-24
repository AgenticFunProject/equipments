import { type FastifyInstance, type FastifyRequest } from "fastify";

import { authenticateBearerToken, ensureScope, type AuthenticatedCaller, type BearerAuthConfig, Scope } from "../auth.js";
import { DomainError } from "../errors.js";
import { EquipmentsStore } from "../store.js";
import { AuditOutcome, type AuditContext } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthenticatedCaller | null;
  }
}

export type AuditedRequest = FastifyRequest & { auth: AuthenticatedCaller | null };

export interface AuditSpec<T> {
  action: string;
  resourceType: string;
  resourceId: (request: AuditedRequest, result?: T) => string;
  requestContext: (request: AuditedRequest, result?: T) => AuditContext;
}

export function registerTransport(app: FastifyInstance, authConfig: BearerAuthConfig): void {
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
}

export function getCallerIdentity(request: FastifyRequest): { issuer: string; subject: string } | undefined {
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

export async function auditedWrite<T>(
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

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}
