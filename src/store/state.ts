import { randomUUID } from "node:crypto";

import type { StoreSnapshot } from "../persistence/index.js";
import { ContainerStatus, type EquipmentType } from "../types.js";
import { cloneAuditEvent, createEmptyState, type StoreState } from "./shared.js";

export function restoreState(snapshot: StoreSnapshot): StoreState {
  return {
    auditEvents: snapshot.auditEvents.map(cloneAuditEvent),
    equipmentTypes: new Map(snapshot.equipmentTypes.map((equipmentType) => [equipmentType.code, equipmentType])),
    users: new Map(snapshot.users.map((user) => [user.id, user])),
    containers: new Map(snapshot.containers.map((container) => [container.id, container])),
    reservations: new Map(snapshot.reservations.map((reservation) => [reservation.id, reservation])),
    reservationByBooking: new Map(snapshot.reservations.map((reservation) => [reservation.bookingReference, reservation.id]))
  };
}

export function initializeState(seed = true): StoreState {
  const state = createEmptyState();
  if (seed) {
    seedState(state);
  }
  return state;
}

export function createSnapshot(state: StoreState): StoreSnapshot {
  return {
    auditEvents: state.auditEvents.map(cloneAuditEvent),
    equipmentTypes: Array.from(state.equipmentTypes.values()),
    users: Array.from(state.users.values()),
    containers: Array.from(state.containers.values()),
    reservations: Array.from(state.reservations.values())
  };
}

function seedState(state: StoreState): void {
  const now = new Date().toISOString();
  const equipmentTypes: Array<Omit<EquipmentType, "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">> = [
    {
      code: "20FT",
      description: "Standard 20-foot dry container",
      nominalLength: "20'",
      maxPayloadKg: 28200
    },
    {
      code: "40FT",
      description: "Standard 40-foot dry container",
      nominalLength: "40'",
      maxPayloadKg: 26500
    },
    {
      code: "40HC",
      description: "40-foot High Cube",
      nominalLength: "40'",
      maxPayloadKg: 26460
    },
    {
      code: "20RF",
      description: "20-foot Reefer",
      nominalLength: "20'",
      maxPayloadKg: 27400
    },
    {
      code: "40RF",
      description: "40-foot Reefer High Cube",
      nominalLength: "40'",
      maxPayloadKg: 26380
    }
  ];

  for (const equipmentType of equipmentTypes) {
    state.equipmentTypes.set(equipmentType.code, {
      ...equipmentType,
      createdByUserId: null,
      lastModifiedByUserId: null,
      createdAt: now,
      updatedAt: now
    });
  }

  const seedContainers = [
    { containerNumber: "CONU1234567", equipmentType: "20FT", currentDepot: "CNSHA-01" },
    { containerNumber: "CONU7654321", equipmentType: "20FT", currentDepot: "CNSHA-01" },
    { containerNumber: "CONU2000001", equipmentType: "20FT", currentDepot: "CNSHA-01" },
    { containerNumber: "CONU3000001", equipmentType: "40FT", currentDepot: "CNSHA-01" },
    { containerNumber: "CONU3000002", equipmentType: "40FT", currentDepot: "CNSHA-01" },
    { containerNumber: "CONU4000001", equipmentType: "40HC", currentDepot: "CNSHA-01" }
  ];

  for (const container of seedContainers) {
    const id = randomUUID();
    state.containers.set(id, {
      id,
      containerNumber: container.containerNumber,
      equipmentType: container.equipmentType,
      status: ContainerStatus.AVAILABLE,
      currentDepot: container.currentDepot,
      bookingReference: null,
      createdByUserId: null,
      lastModifiedByUserId: null,
      lastMovedAt: now,
      createdAt: now,
      updatedAt: now
    });
  }
}
