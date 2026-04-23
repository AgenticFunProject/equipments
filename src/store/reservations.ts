import { randomUUID } from "node:crypto";

import { DomainError } from "../errors.js";
import { type ContainerUnit, ContainerStatus, type CreateReservationRequest, type Reservation, ReservationStatus } from "../types.js";
import { getContainerOrThrow, type ActorIdentity, type StoreState } from "./shared.js";

export function createReservation(
  state: StoreState,
  request: CreateReservationRequest,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): { reservation: Reservation; assignedContainers: Array<{ containerId: string; type: string }> } {
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
  if (state.reservationByBooking.has(bookingReference)) {
    throw new DomainError(`booking ${bookingReference} already has a reservation`, 409);
  }

  const now = new Date().toISOString();
  const actorUserId = findOrCreateUserId(actor);
  const assignmentPlan: ContainerUnit[] = [];
  for (const item of request.equipment) {
    const type = item.type.trim().toUpperCase();
    if (!state.equipmentTypes.has(type)) {
      throw new DomainError(`unknown equipment type ${type}`);
    }
    if (item.quantity <= 0) {
      throw new DomainError(`invalid quantity for ${type}`);
    }

    const candidates = Array.from(state.containers.values()).filter(
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
  state.reservations.set(reservation.id, reservation);
  state.reservationByBooking.set(bookingReference, reservation.id);
  persist();

  return {
    reservation,
    assignedContainers: assignmentPlan.map((container) => ({
      containerId: container.id,
      type: container.equipmentType
    }))
  };
}

export function releaseReservationByBooking(
  state: StoreState,
  bookingReference: string,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): Reservation {
  const reservation = getReservationByBooking(state, bookingReference);
  if (reservation.status === ReservationStatus.RELEASED) {
    return reservation;
  }

  for (const containerId of reservation.containers) {
    const container = getContainerOrThrow(state, containerId);
    if (container.status !== ContainerStatus.RESERVED) {
      throw new DomainError(`reservation for booking ${bookingReference} cannot be released after dispatch`, 409);
    }
  }

  const now = new Date().toISOString();
  const actorUserId = findOrCreateUserId(actor);
  for (const containerId of reservation.containers) {
    const container = getContainerOrThrow(state, containerId);
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
  persist();
  return reservation;
}

export function consumeEvent(
  state: StoreState,
  eventType: string,
  payload: { bookingReference: string },
  actor: ActorIdentity | undefined,
  releaseReservation: (bookingReference: string, actor?: ActorIdentity) => Reservation,
  returnContainer: (id: string, actor?: ActorIdentity) => ContainerUnit,
  persist: () => void
): { processed: boolean } {
  const bookingReference = payload.bookingReference?.trim();
  if (!bookingReference) {
    throw new DomainError("bookingReference is required in event payload");
  }

  if (eventType === "booking.cancelled") {
    releaseReservation(bookingReference, actor);
    return { processed: true };
  }

  if (eventType === "booking.completed") {
    const reservationId = state.reservationByBooking.get(bookingReference);
    if (!reservationId) {
      return { processed: false };
    }
    const reservation = state.reservations.get(reservationId);
    if (!reservation) {
      return { processed: false };
    }
    for (const containerId of reservation.containers) {
      const container = getContainerOrThrow(state, containerId);
      if (container.status === ContainerStatus.DISPATCHED || container.status === ContainerStatus.IN_TRANSIT) {
        returnContainer(container.id, actor);
      }
    }
    persist();
    return { processed: true };
  }

  return { processed: false };
}

function getReservationByBooking(state: StoreState, bookingReference: string): Reservation {
  const reservationId = state.reservationByBooking.get(bookingReference);
  if (!reservationId) {
    throw new DomainError(`reservation for booking ${bookingReference} not found`, 404);
  }
  const reservation = state.reservations.get(reservationId);
  if (!reservation) {
    throw new DomainError(`reservation ${reservationId} not found`, 404);
  }
  return reservation;
}
