import { createPersistence, type RuntimeConfig, type StorePersistence } from "./persistence/index.js";
import type { AuditEvent, AuthorizationRule, ContainerUnit, CreateReservationRequest, EquipmentType, Reservation } from "./types.js";
import { listAuditEvents, recordAuditEvent } from "./store/audit.js";
import { listAuthorizationRules } from "./store/authorization-rules.js";
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
  private state: StoreState;
  private persistence: StorePersistence | null;
  private readonly seedDefaults: boolean;

  constructor(seed = true, persistence: StorePersistence | null = null) {
    this.seedDefaults = seed;
    this.persistence = persistence;
    const snapshot = this.persistence?.load();
    this.state = snapshot ? restoreState(snapshot) : initializeState(seed);

    if (!snapshot) {
      this.persist();
    }
  }

  resetAllData(): { reset: true; seeded: boolean } {
    this.state = initializeState(this.seedDefaults);
    this.persist();
    return { reset: true, seeded: this.seedDefaults };
  }

  clearAllData(): { reset: true; seeded: false } {
    this.state = initializeState(false);
    this.persist();
    return { reset: true, seeded: false };
  }

  listEquipmentTypes(): EquipmentType[] {
    return listEquipmentTypes(this.state);
  }

  listAuditEvents(): AuditEvent[] {
    return listAuditEvents(this.state);
  }

  listAuthorizationRules(): AuthorizationRule[] {
    return listAuthorizationRules(this.state);
  }

  recordAuditEvent(event: Omit<AuditEvent, "id">): AuditEvent {
    return recordAuditEvent(this.state, event, () => this.persist());
  }

  createEquipmentType(input: Omit<EquipmentType, "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">, actor?: ActorIdentity): EquipmentType {
    return createEquipmentType(this.state, input, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  updateEquipmentType(
    code: string,
    input: Partial<Omit<EquipmentType, "code" | "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">>,
    actor?: ActorIdentity
  ): EquipmentType {
    return updateEquipmentType(this.state, code, input, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  registerContainer(input: {
    containerNumber: string;
    equipmentType: string;
    currentDepot: string;
  }, actor?: ActorIdentity): ContainerUnit {
    return registerContainer(this.state, input, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  listContainers(filter: ListContainersFilter): ContainerUnit[] {
    return listContainers(this.state, filter);
  }

  getContainer(id: string): ContainerUnit {
    return getContainer(this.state, id);
  }

  overrideContainerStatus(id: string, status: string, actor?: ActorIdentity): ContainerUnit {
    return overrideContainerStatus(this.state, id, status, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  getAvailability(depotCode?: string): Array<{ equipmentType: string; availableCount: number; depotCode: string }> {
    return getAvailability(this.state, depotCode);
  }

  createReservation(request: CreateReservationRequest, actor?: ActorIdentity): {
    reservation: Reservation;
    assignedContainers: Array<{ containerId: string; type: string }>;
  } {
    return createReservation(this.state, request, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  releaseReservationByBooking(bookingReference: string, actor?: ActorIdentity): Reservation {
    return releaseReservationByBooking(
      this.state,
      bookingReference,
      actor,
      (currentActor) => this.findOrCreateUserId(currentActor),
      () => this.persist()
    );
  }

  pickupContainer(id: string, actor?: ActorIdentity): ContainerUnit {
    return pickupContainer(this.state, id, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  returnContainer(id: string, actor?: ActorIdentity): ContainerUnit {
    return returnContainer(this.state, id, actor, (currentActor) => this.findOrCreateUserId(currentActor), () => this.persist());
  }

  consumeEvent(eventType: string, payload: { bookingReference: string }, actor?: ActorIdentity): { processed: boolean } {
    return consumeEvent(
      this.state,
      eventType,
      payload,
      actor,
      (bookingReference, currentActor) => this.releaseReservationByBooking(bookingReference, currentActor),
      (id, currentActor) => this.returnContainer(id, currentActor),
      () => this.persist()
    );
  }

  private persist(): void {
    this.persistence?.save(createSnapshot(this.state));
  }

  private findOrCreateUserId(actor?: ActorIdentity): string | null {
    return findOrCreateUserId(this.state, actor);
  }
}

export function createStoreFromRuntimeConfig(config: RuntimeConfig, seed = true): EquipmentsStore {
  return new EquipmentsStore(seed && !config.sqliteEmptyOnFirstBoot, createPersistence(config));
}
