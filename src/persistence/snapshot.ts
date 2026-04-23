import type { StoreSnapshot } from "./types.js";

export function parseSnapshot(raw: string): StoreSnapshot {
  const parsed = JSON.parse(raw) as Partial<StoreSnapshot>;
  const now = new Date().toISOString();
  return {
    auditEvents: parsed.auditEvents ?? [],
    equipmentTypes: (parsed.equipmentTypes ?? []).map((equipmentType) => ({
      ...equipmentType,
      createdByUserId: equipmentType.createdByUserId ?? null,
      lastModifiedByUserId: equipmentType.lastModifiedByUserId ?? null,
      createdAt: equipmentType.createdAt ?? now,
      updatedAt: equipmentType.updatedAt ?? equipmentType.createdAt ?? now
    })),
    users: parsed.users ?? [],
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
