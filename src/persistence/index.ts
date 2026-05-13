import { JsonFilePersistence } from "./json-file.js";
import { MemoryPersistence } from "./memory.js";
import { PostgresPersistence } from "./postgres.js";
import { SqlitePersistence } from "./sqlite.js";
import { StorageBackend, type RuntimeConfig, type StorePersistence } from "./types.js";

export { loadRuntimeConfig, normalizeBackend } from "./runtime-config.js";
export {
  POSTGRES_SCHEMA_VERSION,
  SQLITE_SCHEMA_VERSION,
  STORAGE_BACKEND_ENV,
  STORAGE_DB_PATH_ENV,
  STORAGE_POSTGRES_URL_ENV,
  STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT_ENV,
  STORAGE_SQLITE_PATH_ENV,
  StorageBackend,
  type RuntimeConfig,
  type StorePersistence,
  type StoreSnapshot
} from "./types.js";

export function createPersistence(config: RuntimeConfig): StorePersistence {
  switch (config.backend) {
    case StorageBackend.MEMORY:
      return new MemoryPersistence();
    case StorageBackend.DB:
      return new JsonFilePersistence(config.path);
    case StorageBackend.SQLITE:
      return new SqlitePersistence(config.path);
    case StorageBackend.POSTGRES:
      return new PostgresPersistence(config.connectionString ?? "");
  }
}
