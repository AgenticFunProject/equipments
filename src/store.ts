import { createPersistence, type RuntimeConfig, type StorePersistence } from "./persistence/index.js";
import { MemoryPersistence } from "./persistence/memory.js";
import type { AuditEvent, ContainerUnit, CreateReservationRequest, EquipmentType, Reservation } from "./types.js";
import { listAuditEvents, recordAuditEvent } from "./store/audit.js";
import {
  getAvailability,
  getContainer,
  listContainers,
  overrideContainerStatus,
  pickupContainer,
  registerContainer,
  returnContainer
} from "./store/containers.js";
import { createEquipmentType, listEquipmentTypes, updateEquipmentType } from "./store/equipment-types.js";
import { consumeEvent, createReservation, releaseReservationByBooking } from "./store/reservations.js";
import { type ActorIdentity, type ListContainersFilter, type StoreState } from "./store/shared.js";
import { createSnapshot, initializeState, restoreState } from "./store/state.js";
import { findOrCreateUserId } from "./store/users.js";

export class EquipmentsStore {
  private readonly persistence: StorePersistence;

  constructor(private readonly seedDefaults = true, persistence: StorePersistence | null = null) {
    this.persistence = persistence ?? new MemoryPersistence();
  }

  async resetAllData(): Promise<{ reset: true; seeded: boolean }> {
    return this.write(this.seedDefaults, (state) => {
      state.auditEvents.length = 0;
      const nextState = initializeState(this.seedDefaults);
      state.equipmentTypes = nextState.equipmentTypes;
      state.users = nextState.users;
      state.containers = nextState.containers;
      state.reservations = nextState.reservations;
      state.reservationByBooking = nextState.reservationByBooking;
      return { reset: true, seeded: this.seedDefaults };
    });
  }

  async clearAllData(): Promise<{ reset: true; seeded: false }> {
    return this.write(false, (state) => {
      state.auditEvents.length = 0;
      const nextState = initializeState(false);
      state.equipmentTypes = nextState.equipmentTypes;
      state.users = nextState.users;
      state.containers = nextState.containers;
      state.reservations = nextState.reservations;
      state.reservationByBooking = nextState.reservationByBooking;
      return { reset: true, seeded: false };
    });
  }

  async listEquipmentTypes(): Promise<EquipmentType[]> {
    return this.read(this.seedDefaults, (state) => listEquipmentTypes(state));
  }

  async listAuditEvents(): Promise<AuditEvent[]> {
    return this.read(this.seedDefaults, (state) => listAuditEvents(state));
  }

  async recordAuditEvent(event: Omit<AuditEvent, "id">): Promise<AuditEvent> {
    return this.write(this.seedDefaults, (state) => recordAuditEvent(state, event, () => undefined));
  }

  async createEquipmentType(
    input: Omit<EquipmentType, "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">,
    actor?: ActorIdentity
  ): Promise<EquipmentType> {
    return this.write(this.seedDefaults, (state) =>
      createEquipmentType(state, input, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async updateEquipmentType(
    code: string,
    input: Partial<Omit<EquipmentType, "code" | "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">>,
    actor?: ActorIdentity
  ): Promise<EquipmentType> {
    return this.write(this.seedDefaults, (state) =>
      updateEquipmentType(state, code, input, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async registerContainer(input: {
    containerNumber: string;
    equipmentType: string;
    currentDepot: string;
  }, actor?: ActorIdentity): Promise<ContainerUnit> {
    return this.write(this.seedDefaults, (state) =>
      registerContainer(state, input, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async listContainers(filter: ListContainersFilter): Promise<ContainerUnit[]> {
    return this.read(this.seedDefaults, (state) => listContainers(state, filter));
  }

  async getContainer(id: string): Promise<ContainerUnit> {
    return this.read(this.seedDefaults, (state) => getContainer(state, id));
  }

  async overrideContainerStatus(id: string, status: string, actor?: ActorIdentity): Promise<ContainerUnit> {
    return this.write(this.seedDefaults, (state) =>
      overrideContainerStatus(state, id, status, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async getAvailability(depotCode?: string): Promise<Array<{ equipmentType: string; availableCount: number; depotCode: string }>> {
    return this.read(this.seedDefaults, (state) => getAvailability(state, depotCode));
  }

  async createReservation(request: CreateReservationRequest, actor?: ActorIdentity): Promise<{
    reservation: Reservation;
    assignedContainers: Array<{ containerId: string; type: string }>;
  }> {
    return this.write(this.seedDefaults, (state) =>
      createReservation(state, request, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async releaseReservationByBooking(bookingReference: string, actor?: ActorIdentity): Promise<Reservation> {
    return this.write(this.seedDefaults, (state) =>
      releaseReservationByBooking(state, bookingReference, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async pickupContainer(id: string, actor?: ActorIdentity): Promise<ContainerUnit> {
    return this.write(this.seedDefaults, (state) =>
      pickupContainer(state, id, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async returnContainer(id: string, actor?: ActorIdentity): Promise<ContainerUnit> {
    return this.write(this.seedDefaults, (state) =>
      returnContainer(state, id, actor, (currentActor) => findOrCreateUserId(state, currentActor), () => undefined)
    );
  }

  async consumeEvent(eventType: string, payload: { bookingReference: string }, actor?: ActorIdentity): Promise<{ processed: boolean }> {
    return this.write(this.seedDefaults, (state) =>
      consumeEvent(
        state,
        eventType,
        payload,
        actor,
        (bookingReference, currentActor) =>
          releaseReservationByBooking(state, bookingReference, currentActor, (nextActor) => findOrCreateUserId(state, nextActor), () => undefined),
        (id, currentActor) => returnContainer(state, id, currentActor, (nextActor) => findOrCreateUserId(state, nextActor), () => undefined),
        () => undefined
      )
    );
  }

  async close(): Promise<void> {
    await this.persistence.close?.();
  }

  private async read<T>(seed: boolean, action: (state: StoreState) => T): Promise<T> {
    const snapshot = await this.persistence.load();
    const state = snapshot ? restoreState(snapshot) : initializeState(seed);
    if (!snapshot) {
      await this.persistence.save(createSnapshot(state));
    }
    return action(state);
  }

  private async write<T>(seed: boolean, action: (state: StoreState) => T): Promise<T> {
    const persistence = this.persistence as StorePersistence & Partial<import("./persistence/types.js").VersionedStorePersistence>;
    if (typeof persistence.loadWithVersion === "function" && typeof persistence.saveWithVersion === "function") {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const loaded = await persistence.loadWithVersion();
        const state = loaded.snapshot ? restoreState(loaded.snapshot) : initializeState(seed);
        const result = action(state);
        const saved = await persistence.saveWithVersion(createSnapshot(state), loaded.version);
        if (saved) {
          return result;
        }
      }
      throw new Error("failed to persist store after repeated version conflicts");
    }

    const snapshot = await this.persistence.load();
    const state = snapshot ? restoreState(snapshot) : initializeState(seed);
    const result = action(state);
    await this.persistence.save(createSnapshot(state));
    return result;
  }
}

export function createStoreFromRuntimeConfig(config: RuntimeConfig, seed = true): EquipmentsStore {
  return new EquipmentsStore(seed && !config.sqliteEmptyOnFirstBoot, createPersistence(config));
}
