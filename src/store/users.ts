import { randomUUID } from "node:crypto";

import { DomainError } from "../errors.js";
import type { LocalUser } from "../types.js";
import { nextTimestamp, type ActorIdentity, type StoreState } from "./shared.js";

export interface UpsertLocalUserInput {
  id: string;
  externalIdentity?: string;
  issuer: string;
  subject: string;
  displayName?: string | null;
  email?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function findOrCreateUserId(state: StoreState, actor?: ActorIdentity): string | null {
  const issuer = actor?.issuer.trim();
  const subject = actor?.subject.trim();
  if (!issuer || !subject) {
    return null;
  }

  const existing = findUserByIssuerAndSubject(state, issuer, subject);
  if (existing) {
    return existing.id;
  }

  const now = new Date().toISOString();
  const user: LocalUser = {
    id: `usr-${randomUUID()}`,
    externalIdentity: `${issuer}:${subject}`,
    issuer,
    subject,
    displayName: null,
    email: null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now
  };
  state.users.set(user.id, user);
  return user.id;
}

export function listUsers(state: StoreState): LocalUser[] {
  return Array.from(state.users.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function upsertLocalUser(state: StoreState, input: UpsertLocalUserInput, onPersist: () => void): LocalUser {
  const id = input.id.trim();
  const issuer = input.issuer.trim();
  const subject = input.subject.trim();
  if (!id || !issuer || !subject) {
    throw new DomainError("local user upsert requires id, issuer, and subject");
  }

  const existing = state.users.get(id) ?? findUserByIssuerAndSubject(state, issuer, subject);
  const now = nextTimestamp(existing?.updatedAt);
  const user: LocalUser = {
    id: existing?.id ?? id,
    externalIdentity: normalizeOptionalString(input.externalIdentity) ?? existing?.externalIdentity ?? `${issuer}:${subject}`,
    issuer,
    subject,
    displayName: resolveNullableString(input.displayName, existing?.displayName ?? null),
    email: resolveNullableString(input.email, existing?.email ?? null),
    status: normalizeOptionalString(input.status)?.toUpperCase() ?? existing?.status ?? "ACTIVE",
    createdAt: existing?.createdAt ?? normalizeOptionalString(input.createdAt) ?? now,
    updatedAt: normalizeOptionalString(input.updatedAt) ?? now
  };

  state.users.set(user.id, user);
  onPersist();
  return user;
}

function findUserByIssuerAndSubject(state: StoreState, issuer: string, subject: string): LocalUser | undefined {
  return Array.from(state.users.values()).find((user) => user.issuer === issuer && user.subject === subject);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveNullableString(value: string | null | undefined, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback;
  }

  return normalizeOptionalString(value);
}
