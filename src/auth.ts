import { createHmac, timingSafeEqual } from "node:crypto";

import { DomainError } from "./errors.js";

export const AUTH_JWT_ISSUER_ENV = "AUTH_JWT_ISSUER";
export const AUTH_JWT_AUDIENCE_ENV = "AUTH_JWT_AUDIENCE";
export const AUTH_JWT_SECRET_ENV = "AUTH_JWT_SECRET";

export const Scope = {
  READ: "equipments:read",
  MODIFY: "equipments:modify"
} as const;

export type Scope = (typeof Scope)[keyof typeof Scope];

export interface BearerAuthConfig {
  issuer: string;
  audience: string;
  secret: string;
}

export interface AuthenticatedCaller {
  subject: string;
  issuer: string;
  audience: string | string[];
  scopes: string[];
  role?: string;
  expiresAt: number;
}

interface JwtHeader {
  alg?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  scope?: string;
  role?: unknown;
}

interface JwtHeaderOutput {
  alg: "HS256";
  typ: "JWT";
}

export function loadBearerAuthConfig(env = process.env): BearerAuthConfig {
  return {
    issuer: env[AUTH_JWT_ISSUER_ENV]?.trim() || "platform-auth",
    audience: env[AUTH_JWT_AUDIENCE_ENV]?.trim() || "equipments-service",
    secret: env[AUTH_JWT_SECRET_ENV]?.trim() || "equipments-dev-secret"
  };
}

export function authenticateBearerToken(header: string | undefined, config: BearerAuthConfig): AuthenticatedCaller {
  const token = parseBearerHeader(header);
  const [encodedHeader, encodedPayload, encodedSignature, ...rest] = token.split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature || rest.length > 0) {
    throw new DomainError("invalid bearer token", 401);
  }

  const headerJson = decodeBase64UrlJson<JwtHeader>(encodedHeader, "invalid bearer token header");
  const payload = decodeBase64UrlJson<JwtPayload>(encodedPayload, "invalid bearer token payload");

  if (headerJson.alg !== "HS256") {
    throw new DomainError("unsupported bearer token algorithm", 401);
  }

  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", config.secret).update(signedContent).digest();
  const actualSignature = decodeBase64Url(encodedSignature, "invalid bearer token signature");

  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new DomainError("invalid bearer token signature", 401);
  }

  if (!payload.sub?.trim()) {
    throw new DomainError("bearer token subject is required", 401);
  }

  if (payload.iss !== config.issuer) {
    throw new DomainError("bearer token issuer is invalid", 401);
  }

  if (!audienceMatches(payload.aud, config.audience)) {
    throw new DomainError("bearer token audience is invalid", 401);
  }

  const audience = payload.aud;
  if (!audience) {
    throw new DomainError("bearer token audience is invalid", 401);
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new DomainError("bearer token expiry is invalid", 401);
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new DomainError("bearer token is expired", 401);
  }

  const scopes = parseScopes(payload.scope);

  return {
    subject: payload.sub,
    issuer: payload.iss,
    audience,
    scopes,
    role: parseRole(payload.role),
    expiresAt: payload.exp
  };
}

export function ensureScope(caller: AuthenticatedCaller, requiredScope: Scope): void {
  if (caller.role === "admin" || caller.scopes.includes(requiredScope)) {
    return;
  }

  throw new DomainError(`missing required scope ${requiredScope}`, 403);
}

export function createBearerToken(
  config: BearerAuthConfig,
  input: { subject: string; scopes: string[]; expiresInSeconds: number; role?: string }
): string {
  const subject = input.subject.trim();
  if (!subject) {
    throw new DomainError("bearer token subject is required");
  }

  const expiresInSeconds = Math.floor(input.expiresInSeconds);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new DomainError("bearer token expiry must be positive");
  }

  const header: JwtHeaderOutput = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: subject,
    iss: config.issuer,
    aud: config.audience,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    scope: input.scopes.join(" ")
  };
  const role = input.role?.trim();
  if (role) {
    payload.role = role;
  }

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", config.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function parseBearerHeader(header: string | undefined): string {
  if (!header) {
    throw new DomainError("missing bearer token", 401);
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new DomainError("invalid authorization header", 401);
  }

  return match[1].trim();
}

function parseScopes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseRole(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

function audienceMatches(audience: string | string[] | undefined, expectedAudience: string): boolean {
  if (typeof audience === "string") {
    return audience === expectedAudience;
  }

  if (Array.isArray(audience)) {
    return audience.includes(expectedAudience);
  }

  return false;
}

function decodeBase64UrlJson<T>(value: string, message: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new DomainError(message, 401);
  }
}

function decodeBase64Url(value: string, message: string): Buffer {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new DomainError(message, 401);
  }
}
