export const ContainerStatus = {
  AVAILABLE: "AVAILABLE",
  RESERVED: "RESERVED",
  DISPATCHED: "DISPATCHED",
  IN_TRANSIT: "IN_TRANSIT",
  RETURNED: "RETURNED",
  RELEASED: "RELEASED"
} as const;

export type ContainerStatus = (typeof ContainerStatus)[keyof typeof ContainerStatus];

export const ReservationStatus = {
  ACTIVE: "ACTIVE",
  RELEASED: "RELEASED"
} as const;

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export interface EquipmentType {
  code: string;
  description: string;
  nominalLength: string;
  maxPayloadKg: number;
  createdByUserId: string | null;
  lastModifiedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalUser {
  id: string;
  issuer: string;
  subject: string;
  createdAt: string;
}

export interface ContainerUnit {
  id: string;
  containerNumber: string;
  equipmentType: string;
  status: ContainerStatus;
  currentDepot: string;
  bookingReference: string | null;
  createdByUserId: string | null;
  lastModifiedByUserId: string | null;
  lastMovedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reservation {
  id: string;
  bookingReference: string;
  originDepot: string;
  containers: string[];
  status: ReservationStatus;
  createdByUserId: string | null;
  lastModifiedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuditValue = boolean | number | string | string[] | null;

export type AuditContext = Record<string, AuditValue>;

export const AuditOutcome = {
  SUCCESS: "success",
  FAILURE: "failure"
} as const;

export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
  requestContext: AuditContext;
  outcome: AuditOutcome;
  errorMessage: string | null;
}

export interface ReservationItemRequest {
  type: string;
  quantity: number;
}

export interface CreateReservationRequest {
  bookingReference: string;
  originDepot: string;
  equipment: ReservationItemRequest[];
}
