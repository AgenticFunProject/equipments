import { cloneAuthorizationRule, createSeedAuthorizationRules } from "../authorization-rules.js";
import type { StoreSnapshot } from "./types.js";

export function parseSnapshot(raw: string): StoreSnapshot {
  const parsed = JSON.parse(raw) as Partial<StoreSnapshot>;
  const now = new Date().toISOString();
  return {
    auditEvents: parsed.auditEvents ?? [],
    authorizationRules: Array.isArray(parsed.authorizationRules)
      ? parsed.authorizationRules.map((rule) => ({
        ...cloneAuthorizationRule(rule),
        requiredScope: rule.requiredScope ?? null,
        adminAccepted: rule.adminAccepted ?? !rule.public,
        public: rule.public ?? false,
        createdAt: rule.createdAt ?? now,
        updatedAt: rule.updatedAt ?? rule.createdAt ?? now
      }))
      : createSeedAuthorizationRules(now),
    equipmentTypes: (parsed.equipmentTypes ?? []).map((equipmentType) => ({
      ...equipmentType,
      createdByUserId: equipmentType.createdByUserId ?? null,
      lastModifiedByUserId: equipmentType.lastModifiedByUserId ?? null,
      createdAt: equipmentType.createdAt ?? now,
      updatedAt: equipmentType.updatedAt ?? equipmentType.createdAt ?? now
    })),
    users: (parsed.users ?? []).map((user) => ({
      ...user,
      externalIdentity: user.externalIdentity ?? `${user.issuer}:${user.subject}`,
      displayName: user.displayName ?? null,
      email: user.email ?? null,
      status: user.status ?? "ACTIVE",
      createdAt: user.createdAt ?? now,
      updatedAt: user.updatedAt ?? user.createdAt ?? now
    })),
    containers: (parsed.containers ?? []).map((container) => ({
      ...container,
      createdByUserId: container.createdByUserId ?? null,
      lastModifiedByUserId: container.lastModifiedByUserId ?? null,
      createdAt: container.createdAt ?? now,
      updatedAt: container.updatedAt ?? container.createdAt ?? now
    })),
    reservations: (parsed.reservations ?? []).map((reservation) => ({
      ...reservation,
      createdByUserId: reservation.createdByUserId ?? null,
      lastModifiedByUserId: reservation.lastModifiedByUserId ?? null,
      createdAt: reservation.createdAt ?? now,
      updatedAt: reservation.updatedAt ?? reservation.createdAt ?? now
    }))
  };
}

export function cloneSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  return parseSnapshot(JSON.stringify(snapshot));
}

export function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
