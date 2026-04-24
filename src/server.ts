import Fastify, { type FastifyInstance } from "fastify";

import { type BearerAuthConfig, loadBearerAuthConfig } from "./auth.js";
import { type RuntimeConfig, StorageBackend } from "./persistence/index.js";
import { registerRoutes } from "./server/routes.js";
import { registerTransport } from "./server/transport.js";
import { EquipmentsStore } from "./store.js";

const defaultRuntimeConfig: RuntimeConfig = { backend: StorageBackend.MEMORY, path: "", sqliteEmptyOnFirstBoot: false };
const defaultDevMode = process.env.NODE_ENV !== "production";

export function buildServer(
  store = new EquipmentsStore(),
  runtimeConfig: RuntimeConfig = defaultRuntimeConfig,
  devMode = defaultDevMode,
  authConfig: BearerAuthConfig = loadBearerAuthConfig()
): FastifyInstance {
  const app = Fastify({ logger: false });

  registerTransport(app, authConfig);
  registerRoutes(app, { store, runtimeConfig, devMode, authConfig });

  return app;
}
