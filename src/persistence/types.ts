import type { AuditEvent, ContainerUnit, EquipmentType, LocalUser, Reservation } from "../types.js";

export const StorageBackend = {
  MEMORY: "memory",
  DB: "db",
  SQLITE: "sqlite"
} as const;

export type StorageBackend = (typeof StorageBackend)[keyof typeof StorageBackend];

export const STORAGE_BACKEND_ENV = "STORAGE_BACKEND";
export const STORAGE_DB_PATH_ENV = "STORAGE_DB_PATH";
export const STORAGE_SQLITE_PATH_ENV = "STORAGE_SQLITE_PATH";
export const STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV = "STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT";
export const SQLITE_SCHEMA_VERSION = 5;

export interface StoreSnapshot {
  auditEvents: AuditEvent[];
  equipmentTypes: EquipmentType[];
  users: LocalUser[];
  containers: ContainerUnit[];
  reservations: Reservation[];
}

export interface StorePersistence {
  load(): StoreSnapshot | null;
  save(snapshot: StoreSnapshot): void;
}

export interface RuntimeConfig {
  backend: StorageBackend;
  path: string;
  sqliteEmptyOnFirstBoot?: boolean;
}
