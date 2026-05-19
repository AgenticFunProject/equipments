import { DomainError } from "../errors.js";
import { type AuditEvent, type AuthorizationRule, type ContainerUnit, ContainerStatus, type EquipmentType, type LocalUser, type Reservation } from "../types.js";

export interface ActorIdentity {
  issuer: string;
  subject: string;
}

export interface ListContainersFilter {
  type?: string;
  status?: string;
  depot?: string;
}

export interface StoreState {
  auditEvents: AuditEvent[];
  authorizationRules: Map<string, AuthorizationRule>;
  equipmentTypes: Map<string, EquipmentType>;
  users: Map<string, LocalUser>;
  containers: Map<string, ContainerUnit>;
  reservations: Map<string, Reservation>;
  reservationByBooking: Map<string, string>;
}

export function createEmptyState(): StoreState {
  return {
    auditEvents: [],
    authorizationRules: new Map(),
    equipmentTypes: new Map(),
    users: new Map(),
    containers: new Map(),
    reservations: new Map(),
    reservationByBooking: new Map()
  };
}

export function cloneAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    requestContext: { ...event.requestContext }
  };
}

export function getContainerOrThrow(state: StoreState, id: string): ContainerUnit {
  const container = state.containers.get(id);
  if (!container) {
    throw new DomainError(`container ${id} not found`, 404);
  }
  return container;
}

export function normalizeContainerStatus(status: string): ContainerStatus {
  const normalized = status.trim().toUpperCase();
  if (!Object.values(ContainerStatus).includes(normalized as ContainerStatus)) {
    throw new DomainError(`invalid container status ${normalized}`);
  }
  return normalized as ContainerStatus;
}

export function nextTimestampAfter(previousTimestamp: string): string {
  const previous = Date.parse(previousTimestamp);
  const now = Date.now();
  if (Number.isFinite(previous) && now <= previous) {
    return new Date(previous + 1).toISOString();
  }
  return new Date(now).toISOString();
}
