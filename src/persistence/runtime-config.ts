import { DomainError } from "../errors.js";

import {
  type RuntimeConfig,
  STORAGE_BACKEND_ENV,
  STORAGE_DB_PATH_ENV,
  STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV,
  STORAGE_SQLITE_PATH_ENV,
  StorageBackend,
  type StorageBackend as StorageBackendValue
} from "./types.js";

export function normalizeBackend(raw: string | undefined): StorageBackendValue {
  switch (raw?.trim().toLowerCase() ?? "") {
    case "":
    case StorageBackend.MEMORY:
      return StorageBackend.MEMORY;
    case StorageBackend.DB:
    case "persistent":
    case "persistent-db":
      return StorageBackend.DB;
    case StorageBackend.SQLITE:
    case "sqlite3":
    case "sql":
    case "persistent-sqlite":
    case "persistent-sqlite3":
      return StorageBackend.SQLITE;
    default:
      throw new DomainError(`unsupported storage backend ${JSON.stringify(raw ?? "")}`);
  }
}

export function loadRuntimeConfig(env = process.env): RuntimeConfig {
  const backend = normalizeBackend(env[STORAGE_BACKEND_ENV]);
  if (backend === StorageBackend.MEMORY) {
    return { backend, path: "", sqliteEmptyOnFirstBoot: false };
  }

  if (backend === StorageBackend.DB) {
    const path = env[STORAGE_DB_PATH_ENV]?.trim() ?? "";
    if (!path) {
      throw new DomainError(`${STORAGE_DB_PATH_ENV} is required when ${STORAGE_BACKEND_ENV}=db`);
    }
    return { backend, path, sqliteEmptyOnFirstBoot: false };
  }

  const path = env[STORAGE_SQLITE_PATH_ENV]?.trim() || env[STORAGE_DB_PATH_ENV]?.trim() || "";
  if (!path) {
    throw new DomainError(
      `${STORAGE_SQLITE_PATH_ENV} or ${STORAGE_DB_PATH_ENV} is required when ${STORAGE_BACKEND_ENV}=sqlite`
    );
  }

  return {
    backend,
    path,
    sqliteEmptyOnFirstBoot: parseBooleanFlag(env[STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV])
  };
}

function parseBooleanFlag(raw: string | undefined): boolean {
  switch (raw?.trim().toLowerCase()) {
    case undefined:
    case "":
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      throw new DomainError(`unsupported boolean flag value ${JSON.stringify(raw)}`);
  }
}
