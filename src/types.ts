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
  lastMovedAt: string;
  createdAt: string;
}

export interface Reservation {
  id: string;
  bookingReference: string;
  originDepot: string;
  containers: string[];
  status: ReservationStatus;
  createdAt: string;
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
