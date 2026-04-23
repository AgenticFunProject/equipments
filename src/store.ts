import { randomUUID } from "node:crypto";

import { DomainError } from "./errors.js";
import { createPersistence, type RuntimeConfig, type StorePersistence, type StoreSnapshot } from "./persistence/index.js";
import {
  type AuditEvent,
  type ContainerUnit,
  ContainerStatus,
  type CreateReservationRequest,
  type EquipmentType,
  type LocalUser,
  type Reservation,
  ReservationStatus
} from "./types.js";

interface ActorIdentity {
  issuer: string;
  subject: string;
}

interface ListContainersFilter {
  type?: string;
  status?: string;
  depot?: string;
}

export class EquipmentsStore {
  private auditEvents: AuditEvent[] = [];
  private equipmentTypes = new Map<string, EquipmentType>();
  private users = new Map<string, LocalUser>();
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

  listAuditEvents(): AuditEvent[] {
    return this.auditEvents.map((event) => ({
      ...event,
      requestContext: { ...event.requestContext }
    }));
  }

  recordAuditEvent(event: Omit<AuditEvent, "id">): AuditEvent {
    const auditEvent: AuditEvent = {
      id: randomUUID(),
      ...event,
      requestContext: { ...event.requestContext }
    };
    this.auditEvents.push(auditEvent);
    this.persist();
    return auditEvent;
  }

  createEquipmentType(input: Omit<EquipmentType, "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">, actor?: ActorIdentity): EquipmentType {
    const code = input.code.trim().toUpperCase();
    if (!code) {
      throw new DomainError("equipment type code is required");
    }
    if (this.equipmentTypes.has(code)) {
      throw new DomainError(`equipment type ${code} already exists`, 409);
    }

    const now = new Date().toISOString();
    const actorUserId = this.findOrCreateUserId(actor);
    const equipmentType: EquipmentType = {
      code,
      description: input.description.trim(),
      nominalLength: input.nominalLength.trim(),
      maxPayloadKg: input.maxPayloadKg,
      createdByUserId: actorUserId,
      lastModifiedByUserId: actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.validateEquipmentType(equipmentType);
    this.equipmentTypes.set(code, equipmentType);
    this.persist();
    return equipmentType;
  }

  updateEquipmentType(
    code: string,
    input: Partial<Omit<EquipmentType, "code" | "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">>,
    actor?: ActorIdentity
  ): EquipmentType {
    const key = code.trim().toUpperCase();
    const current = this.equipmentTypes.get(key);
    if (!current) {
      throw new DomainError(`equipment type ${key} not found`, 404);
    }

    const now = new Date().toISOString();
    const next: EquipmentType = {
      code: current.code,
      description: input.description?.trim() ?? current.description,
      nominalLength: input.nominalLength?.trim() ?? current.nominalLength,
      maxPayloadKg: input.maxPayloadKg ?? current.maxPayloadKg,
      createdByUserId: current.createdByUserId,
      lastModifiedByUserId: this.findOrCreateUserId(actor),
      createdAt: current.createdAt,
      updatedAt: now
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
  }, actor?: ActorIdentity): ContainerUnit {
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
    const actorUserId = this.findOrCreateUserId(actor);
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

  overrideContainerStatus(id: string, status: string, actor?: ActorIdentity): ContainerUnit {
    const container = this.getContainer(id);
    const normalized = status.trim().toUpperCase();
    if (!Object.values(ContainerStatus).includes(normalized as typeof ContainerStatus[keyof typeof ContainerStatus])) {
      throw new DomainError(`invalid container status ${normalized}`);
    }
    const now = new Date().toISOString();
    container.status = normalized as ContainerUnit["status"];
    container.lastMovedAt = now;
    container.lastModifiedByUserId = this.findOrCreateUserId(actor);
    container.updatedAt = now;
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

  createReservation(request: CreateReservationRequest, actor?: ActorIdentity): {
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

    const now = new Date().toISOString();
    const actorUserId = this.findOrCreateUserId(actor);
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
      container.lastModifiedByUserId = actorUserId;
      container.lastMovedAt = now;
      container.updatedAt = now;
    }

    const reservation: Reservation = {
      id: randomUUID(),
      bookingReference,
      originDepot,
      containers: assignmentPlan.map((container) => container.id),
      status: ReservationStatus.ACTIVE,
      createdByUserId: actorUserId,
      lastModifiedByUserId: actorUserId,
      createdAt: now,
      updatedAt: now
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

  releaseReservationByBooking(bookingReference: string, actor?: ActorIdentity): Reservation {
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
      if (container.status !== ContainerStatus.RESERVED) {
        throw new DomainError(
          `reservation for booking ${bookingReference} cannot be released after dispatch`,
          409
        );
      }
    }

    const now = new Date().toISOString();
    const actorUserId = this.findOrCreateUserId(actor);
    for (const containerId of reservation.containers) {
      const container = this.getContainer(containerId);
      if (container.status === ContainerStatus.RESERVED) {
        container.status = ContainerStatus.AVAILABLE;
        container.bookingReference = null;
        container.lastModifiedByUserId = actorUserId;
        container.lastMovedAt = now;
        container.updatedAt = now;
      }
    }

    reservation.status = ReservationStatus.RELEASED;
    reservation.lastModifiedByUserId = actorUserId;
    reservation.updatedAt = now;
    this.persist();
    return reservation;
  }

  pickupContainer(id: string, actor?: ActorIdentity): ContainerUnit {
    const container = this.getContainer(id);
    if (container.status !== ContainerStatus.RESERVED) {
      throw new DomainError("pickup allowed only when status is RESERVED", 409);
    }
    const now = new Date().toISOString();
    container.status = ContainerStatus.DISPATCHED;
    container.lastModifiedByUserId = this.findOrCreateUserId(actor);
    container.lastMovedAt = now;
    container.updatedAt = now;
    this.persist();
    return container;
  }

  returnContainer(id: string, actor?: ActorIdentity): ContainerUnit {
    const container = this.getContainer(id);
    if (container.status !== ContainerStatus.DISPATCHED && container.status !== ContainerStatus.IN_TRANSIT) {
      throw new DomainError("return allowed only when status is DISPATCHED or IN_TRANSIT", 409);
    }
    const now = new Date().toISOString();
    container.status = ContainerStatus.AVAILABLE;
    container.bookingReference = null;
    container.lastModifiedByUserId = this.findOrCreateUserId(actor);
    container.lastMovedAt = now;
    container.updatedAt = now;
    this.persist();
    return container;
  }

  consumeEvent(eventType: string, payload: { bookingReference: string }, actor?: ActorIdentity): { processed: boolean } {
    const bookingReference = payload.bookingReference?.trim();
    if (!bookingReference) {
      throw new DomainError("bookingReference is required in event payload");
    }

    if (eventType === "booking.cancelled") {
      this.releaseReservationByBooking(bookingReference, actor);
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
          this.returnContainer(container.id, actor);
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
    this.auditEvents = snapshot.auditEvents.map((event) => ({
      ...event,
      requestContext: { ...event.requestContext }
    }));
    this.equipmentTypes = new Map(snapshot.equipmentTypes.map((equipmentType) => [equipmentType.code, equipmentType]));
    this.users = new Map(snapshot.users.map((user) => [user.id, user]));
    this.containers = new Map(snapshot.containers.map((container) => [container.id, container]));
    this.reservations = new Map(snapshot.reservations.map((reservation) => [reservation.id, reservation]));
    this.reservationByBooking = new Map(snapshot.reservations.map((reservation) => [reservation.bookingReference, reservation.id]));
  }

  private initializeState(seed = this.seedDefaults): void {
    this.equipmentTypes = new Map();
    this.users = new Map();
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
      auditEvents: this.listAuditEvents(),
      equipmentTypes: this.listEquipmentTypes(),
      users: Array.from(this.users.values()),
      containers: Array.from(this.containers.values()),
      reservations: Array.from(this.reservations.values())
    });
  }

  private seedData(): void {
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
      this.equipmentTypes.set(equipmentType.code, {
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
      this.containers.set(id, {
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

  private findOrCreateUserId(actor?: ActorIdentity): string | null {
    const issuer = actor?.issuer.trim();
    const subject = actor?.subject.trim();
    if (!issuer || !subject) {
      return null;
    }

    const existing = Array.from(this.users.values()).find((user) => user.issuer === issuer && user.subject === subject);
    if (existing) {
      return existing.id;
    }

    const user: LocalUser = {
      id: `usr-${randomUUID()}`,
      issuer,
      subject,
      createdAt: new Date().toISOString()
    };
    this.users.set(user.id, user);
    return user.id;
  }
}

export function createStoreFromRuntimeConfig(config: RuntimeConfig, seed = true): EquipmentsStore {
  return new EquipmentsStore(seed && !config.sqliteEmptyOnFirstBoot, createPersistence(config));
}
