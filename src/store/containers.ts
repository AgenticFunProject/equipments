import { randomUUID } from "node:crypto";

import { DomainError } from "../errors.js";
import { type ContainerUnit, ContainerStatus } from "../types.js";
import { getContainerOrThrow, type ActorIdentity, type ListContainersFilter, normalizeContainerStatus, type StoreState } from "./shared.js";

export function registerContainer(
  state: StoreState,
  input: {
    containerNumber: string;
    equipmentType: string;
    currentDepot: string;
  },
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): ContainerUnit {
  const equipmentType = input.equipmentType.trim().toUpperCase();
  if (!state.equipmentTypes.has(equipmentType)) {
    throw new DomainError(`unknown equipment type ${equipmentType}`);
  }

  const containerNumber = input.containerNumber.trim().toUpperCase();
  if (!containerNumber) {
    throw new DomainError("containerNumber is required");
  }

  if (Array.from(state.containers.values()).some((container) => container.containerNumber === containerNumber)) {
    throw new DomainError(`container ${containerNumber} already exists`, 409);
  }

  const now = new Date().toISOString();
  const actorUserId = findOrCreateUserId(actor);
  const container: ContainerUnit = {
    id: randomUUID(),
    containerNumber,
    equipmentType,
    status: ContainerStatus.AVAILABLE,
    currentDepot: input.currentDepot.trim().toUpperCase(),
    bookingReference: null,
    createdByUserId: actorUserId,
    lastModifiedByUserId: actorUserId,
    lastMovedAt: now,
    createdAt: now,
    updatedAt: now
  };
  state.containers.set(container.id, container);
  persist();
  return container;
}

export function listContainers(state: StoreState, filter: ListContainersFilter): ContainerUnit[] {
  return Array.from(state.containers.values()).filter((container) => {
    if (filter.type && container.equipmentType !== filter.type.toUpperCase()) {
      return false;
    }
    if (filter.status && container.status !== filter.status.toUpperCase()) {
      return false;
    }
    if (filter.depot && container.currentDepot !== filter.depot.toUpperCase()) {
      return false;
    }
    return true;
  });
}

export function getContainer(state: StoreState, id: string): ContainerUnit {
  return getContainerOrThrow(state, id);
}

export function overrideContainerStatus(
  state: StoreState,
  id: string,
  status: string,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): ContainerUnit {
  const container = getContainerOrThrow(state, id);
  const now = new Date().toISOString();
  container.status = normalizeContainerStatus(status);
  container.lastMovedAt = now;
  container.lastModifiedByUserId = findOrCreateUserId(actor);
  container.updatedAt = now;
  if (container.status === ContainerStatus.AVAILABLE) {
    container.bookingReference = null;
  }
  persist();
  return container;
}

export function getAvailability(state: StoreState, depotCode?: string): Array<{ equipmentType: string; availableCount: number; depotCode: string }> {
  const counts = new Map<string, number>();
  for (const container of state.containers.values()) {
    if (container.status !== ContainerStatus.AVAILABLE) {
      continue;
    }
    if (depotCode && container.currentDepot !== depotCode.toUpperCase()) {
      continue;
    }

    const key = `${container.equipmentType}::${container.currentDepot}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([key, availableCount]) => {
    const [equipmentType, depot] = key.split("::");
    return {
      equipmentType,
      availableCount,
      depotCode: depot
    };
  });
}

export function pickupContainer(
  state: StoreState,
  id: string,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): ContainerUnit {
  const container = getContainerOrThrow(state, id);
  if (container.status !== ContainerStatus.RESERVED) {
    throw new DomainError("pickup allowed only when status is RESERVED", 409);
  }

  const now = new Date().toISOString();
  container.status = ContainerStatus.DISPATCHED;
  container.lastModifiedByUserId = findOrCreateUserId(actor);
  container.lastMovedAt = now;
  container.updatedAt = now;
  persist();
  return container;
}

export function returnContainer(
  state: StoreState,
  id: string,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): ContainerUnit {
  const container = getContainerOrThrow(state, id);
  if (container.status !== ContainerStatus.DISPATCHED && container.status !== ContainerStatus.IN_TRANSIT) {
    throw new DomainError("return allowed only when status is DISPATCHED or IN_TRANSIT", 409);
  }

  const now = new Date().toISOString();
  container.status = ContainerStatus.AVAILABLE;
  container.bookingReference = null;
  container.lastModifiedByUserId = findOrCreateUserId(actor);
  container.lastMovedAt = now;
  container.updatedAt = now;
  persist();
  return container;
}
