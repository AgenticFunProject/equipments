import { loadBearerAuthConfig } from "./auth.js";
import { buildServer } from "./server.js";
import { assertRuntimeSchemaReady, loadRuntimeConfig } from "./persistence/index.js";
import { createStoreFromRuntimeConfig } from "./store.js";

const config = loadRuntimeConfig();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

assertRuntimeSchemaReady(config)
  .then(() => buildServer(createStoreFromRuntimeConfig(config), config, undefined, loadBearerAuthConfig()))
  .then((app) =>
    app.listen({ port, host }).then(() => {
      const storageLabel = config.path ? `${config.backend} (${config.path})` : config.backend;
      process.stdout.write(`equipments-service listening on http://${host}:${port} using ${storageLabel} storage\n`);
    })
  )
  .catch((error) => {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  });
