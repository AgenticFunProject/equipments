import { randomUUID } from "node:crypto";

import { DomainError } from "./errors.js";
import { createPersistence, type RuntimeConfig, type StorePersistence, type StoreSnapshot } from "./persistence.js";
import {
  type ContainerUnit,
  ContainerStatus,
  type CreateReservationRequest,
  type EquipmentType,
  type Reservation,
  ReservationStatus
} from "./types.js";

interface ListContainersFilter {
  type?: string;
  status?: string;
  depot?: string;
}

export class EquipmentsStore {
  private equipmentTypes = new Map<string, EquipmentType>();
  private containers = new Map<string, ContainerUnit>();
  private reservations = new Map<string, Reservation>();
  private reservationByBooking = new Map<string, string>();
  private persistence: StorePersistence | null;
  private readonly seedDefaults: boolean;

  constructor(seed = true, persistence: StorePersistence | null = null) {
    this.seedDefaults = seed;
    this.persistence = persistence;
    const snapshot = this.persistence?.load();
    if (snapshot) {
      this.restore(snapshot);
      return;
    }

    this.initializeState();
  }

  resetAllData(): { reset: true; seeded: boolean } {
    this.initializeState(this.seedDefaults);
    return { reset: true, seeded: this.seedDefaults };
  }

  clearAllData(): { reset: true; seeded: false } {
    this.initializeState(false);
    return { reset: true, seeded: false };
  }

  listEquipmentTypes(): EquipmentType[] {
    return Array.from(this.equipmentTypes.values());
  }

  createEquipmentType(input: EquipmentType): EquipmentType {
    const code = input.code.trim().toUpperCase();
    if (!code) {
      throw new DomainError("equipment type code is required");
    }
    if (this.equipmentTypes.has(code)) {
      throw new DomainError(`equipment type ${code} already exists`, 409);
    }

    const equipmentType: EquipmentType = {
      code,
      description: input.description.trim(),
      nominalLength: input.nominalLength.trim(),
      maxPayloadKg: input.maxPayloadKg
    };
    this.validateEquipmentType(equipmentType);
    this.equipmentTypes.set(code, equipmentType);
    this.persist();
    return equipmentType;
  }

  updateEquipmentType(code: string, input: Partial<EquipmentType>): EquipmentType {
    const key = code.trim().toUpperCase();
    const current = this.equipmentTypes.get(key);
    if (!current) {
      throw new DomainError(`equipment type ${key} not found`, 404);
    }

    const next: EquipmentType = {
      code: current.code,
      description: input.description?.trim() ?? current.description,
      nominalLength: input.nominalLength?.trim() ?? current.nominalLength,
      maxPayloadKg: input.maxPayloadKg ?? current.maxPayloadKg
    };
    this.validateEquipmentType(next);
    this.equipmentTypes.set(key, next);
    this.persist();
    return next;
  }

  registerContainer(input: {
    containerNumber: string;
    equipmentType: string;
    currentDepot: string;
  }): ContainerUnit {
    const equipmentType = input.equipmentType.trim().toUpperCase();
    if (!this.equipmentTypes.has(equipmentType)) {
      throw new DomainError(`unknown equipment type ${equipmentType}`);
    }

    const containerNumber = input.containerNumber.trim().toUpperCase();
    if (!containerNumber) {
      throw new DomainError("containerNumber is required");
    }

    if (Array.from(this.containers.values()).some((c) => c.containerNumber === containerNumber)) {
      throw new DomainError(`container ${containerNumber} already exists`, 409);
    }

    const now = new Date().toISOString();
    const container: ContainerUnit = {
      id: randomUUID(),
      containerNumber,
      equipmentType,
      status: ContainerStatus.AVAILABLE,
      currentDepot: input.currentDepot.trim().toUpperCase(),
      bookingReference: null,
      lastMovedAt: now,
      createdAt: now
    };
    this.containers.set(container.id, container);
    this.persist();
    return container;
  }

  listContainers(filter: ListContainersFilter): ContainerUnit[] {
    return Array.from(this.containers.values()).filter((container) => {
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

  getContainer(id: string): ContainerUnit {
    const container = this.containers.get(id);
    if (!container) {
      throw new DomainError(`container ${id} not found`, 404);
    }
    return container;
  }

  overrideContainerStatus(id: string, status: string): ContainerUnit {
    const container = this.getContainer(id);
    const normalized = status.trim().toUpperCase();
    if (!Object.values(ContainerStatus).includes(normalized as typeof ContainerStatus[keyof typeof ContainerStatus])) {
      throw new DomainError(`invalid container status ${normalized}`);
    }
    container.status = normalized as ContainerUnit["status"];
    container.lastMovedAt = new Date().toISOString();
    if (container.status === ContainerStatus.AVAILABLE) {
      container.bookingReference = null;
    }
    this.persist();
    return container;
  }

  getAvailability(depotCode?: string): Array<{ equipmentType: string; availableCount: number; depotCode: string }> {
    const counts = new Map<string, number>();
    for (const container of this.containers.values()) {
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

  createReservation(request: CreateReservationRequest): {
    reservation: Reservation;
    assignedContainers: Array<{ containerId: string; type: string }>;
  } {
    const bookingReference = request.bookingReference.trim();
    const originDepot = request.originDepot.trim().toUpperCase();
    if (!bookingReference) {
      throw new DomainError("bookingReference is required");
    }
    if (!originDepot) {
      throw new DomainError("originDepot is required");
    }
    if (!request.equipment.length) {
      throw new DomainError("equipment list cannot be empty");
    }
    if (this.reservationByBooking.has(bookingReference)) {
      throw new DomainError(`booking ${bookingReference} already has a reservation`, 409);
    }

    const assignmentPlan: ContainerUnit[] = [];
    for (const item of request.equipment) {
      const type = item.type.trim().toUpperCase();
      if (!this.equipmentTypes.has(type)) {
        throw new DomainError(`unknown equipment type ${type}`);
      }
      if (item.quantity <= 0) {
        throw new DomainError(`invalid quantity for ${type}`);
      }

      const candidates = Array.from(this.containers.values()).filter(
        (container) =>
          container.equipmentType === type &&
          container.currentDepot === originDepot &&
          container.status === ContainerStatus.AVAILABLE
      );

      if (candidates.length < item.quantity) {
        throw new DomainError(`insufficient available ${type} at depot ${originDepot}`, 409);
      }

      assignmentPlan.push(...candidates.slice(0, item.quantity));
    }

    for (const container of assignmentPlan) {
      container.status = ContainerStatus.RESERVED;
      container.bookingReference = bookingReference;
      container.lastMovedAt = new Date().toISOString();
    }

    const reservation: Reservation = {
      id: randomUUID(),
      bookingReference,
      originDepot,
      containers: assignmentPlan.map((container) => container.id),
      status: ReservationStatus.ACTIVE,
      createdAt: new Date().toISOString()
    };
    this.reservations.set(reservation.id, reservation);
    this.reservationByBooking.set(bookingReference, reservation.id);
    this.persist();

    return {
      reservation,
      assignedContainers: assignmentPlan.map((container) => ({
        containerId: container.id,
        type: container.equipmentType
      }))
    };
  }

  releaseReservationByBooking(bookingReference: string): Reservation {
    const reservationId = this.reservationByBooking.get(bookingReference);
    if (!reservationId) {
      throw new DomainError(`reservation for booking ${bookingReference} not found`, 404);
    }
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new DomainError(`reservation ${reservationId} not found`, 404);
    }
    if (reservation.status === ReservationStatus.RELEASED) {
      return reservation;
    }

    for (const containerId of reservation.containers) {
      const container = this.getContainer(containerId);
      if (container.status === ContainerStatus.RESERVED) {
        container.status = ContainerStatus.AVAILABLE;
        container.bookingReference = null;
        container.lastMovedAt = new Date().toISOString();
      }
    }

    reservation.status = ReservationStatus.RELEASED;
    this.persist();
    return reservation;
  }

  pickupContainer(id: string): ContainerUnit {
    const container = this.getContainer(id);
    if (container.status !== ContainerStatus.RESERVED) {
      throw new DomainError("pickup allowed only when status is RESERVED", 409);
    }
    container.status = ContainerStatus.DISPATCHED;
    container.lastMovedAt = new Date().toISOString();
    this.persist();
    return container;
  }

  returnContainer(id: string): ContainerUnit {
    const container = this.getContainer(id);
    if (container.status !== ContainerStatus.DISPATCHED && container.status !== ContainerStatus.IN_TRANSIT) {
      throw new DomainError("return allowed only when status is DISPATCHED or IN_TRANSIT", 409);
    }
    container.status = ContainerStatus.RETURNED;
    container.lastMovedAt = new Date().toISOString();
    this.persist();
    return container;
  }

  consumeEvent(eventType: string, payload: { bookingReference: string }): { processed: boolean } {
    const bookingReference = payload.bookingReference?.trim();
    if (!bookingReference) {
      throw new DomainError("bookingReference is required in event payload");
    }

    if (eventType === "booking.cancelled") {
      this.releaseReservationByBooking(bookingReference);
      return { processed: true };
    }

    if (eventType === "booking.completed") {
      const reservationId = this.reservationByBooking.get(bookingReference);
      if (!reservationId) {
        return { processed: false };
      }
      const reservation = this.reservations.get(reservationId);
      if (!reservation) {
        return { processed: false };
      }
      for (const containerId of reservation.containers) {
        const container = this.getContainer(containerId);
        if (container.status === ContainerStatus.DISPATCHED || container.status === ContainerStatus.IN_TRANSIT) {
          this.returnContainer(container.id);
        }
      }
      this.persist();
      return { processed: true };
    }

    return { processed: false };
  }

  private validateEquipmentType(equipmentType: EquipmentType): void {
    if (!equipmentType.description) {
      throw new DomainError("description is required");
    }
    if (!equipmentType.nominalLength) {
      throw new DomainError("nominalLength is required");
    }
    if (!Number.isFinite(equipmentType.maxPayloadKg) || equipmentType.maxPayloadKg <= 0) {
      throw new DomainError("maxPayloadKg must be a positive number");
    }
  }

  private restore(snapshot: StoreSnapshot): void {
    this.equipmentTypes = new Map(snapshot.equipmentTypes.map((equipmentType) => [equipmentType.code, equipmentType]));
    this.containers = new Map(snapshot.containers.map((container) => [container.id, container]));
    this.reservations = new Map(snapshot.reservations.map((reservation) => [reservation.id, reservation]));
    this.reservationByBooking = new Map(snapshot.reservations.map((reservation) => [reservation.bookingReference, reservation.id]));
  }

  private initializeState(seed = this.seedDefaults): void {
    this.equipmentTypes = new Map();
    this.containers = new Map();
    this.reservations = new Map();
    this.reservationByBooking = new Map();

    if (seed) {
      this.seedData();
    }

    this.persist();
  }

  private persist(): void {
    this.persistence?.save({
      equipmentTypes: this.listEquipmentTypes(),
      containers: Array.from(this.containers.values()),
      reservations: Array.from(this.reservations.values())
    });
  }

  private seedData(): void {
    const equipmentTypes: EquipmentType[] = [
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
      this.equipmentTypes.set(equipmentType.code, equipmentType);
    }

    const seedContainers = [
      { containerNumber: "CONU1234567", equipmentType: "20FT", currentDepot: "CNSHA-01" },
      { containerNumber: "CONU7654321", equipmentType: "20FT", currentDepot: "CNSHA-01" },
      { containerNumber: "CONU2000001", equipmentType: "20FT", currentDepot: "CNSHA-01" },
      { containerNumber: "CONU3000001", equipmentType: "40FT", currentDepot: "CNSHA-01" },
      { containerNumber: "CONU3000002", equipmentType: "40FT", currentDepot: "CNSHA-01" },
      { containerNumber: "CONU4000001", equipmentType: "40HC", currentDepot: "CNSHA-01" }
    ];

    const now = new Date().toISOString();
    for (const container of seedContainers) {
      const id = randomUUID();
      this.containers.set(id, {
        id,
        containerNumber: container.containerNumber,
        equipmentType: container.equipmentType,
        status: ContainerStatus.AVAILABLE,
        currentDepot: container.currentDepot,
        bookingReference: null,
        lastMovedAt: now,
        createdAt: now
      });
    }
  }
}

export function createStoreFromRuntimeConfig(config: RuntimeConfig, seed = true): EquipmentsStore {
  return new EquipmentsStore(seed && !config.sqliteEmptyOnFirstBoot, createPersistence(config));
}
