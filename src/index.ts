import { loadBearerAuthConfig } from "./auth.js";
import { buildServer } from "./server.js";
import { loadRuntimeConfig } from "./persistence/index.js";
import { createStoreFromRuntimeConfig } from "./store.js";
import { startUserEventsConsumer } from "./user-events.js";

const config = loadRuntimeConfig();
const store = createStoreFromRuntimeConfig(config);
const app = buildServer(store, config, undefined, loadBearerAuthConfig());
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .then(async () => {
    const storageLabel = config.path ? `${config.backend} (${config.path})` : config.backend;
    process.stdout.write(`equipments-service listening on http://${host}:${port} using ${storageLabel} storage\n`);
    await startUserEventsConsumer(store);
  })
  .catch((error) => {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  });
