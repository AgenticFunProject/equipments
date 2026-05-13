import { loadRuntimeConfig, runMigrations } from "./index.js";

const action = process.argv[2] === "status" ? "status" : "up";
const result = await runMigrations(loadRuntimeConfig(), action);

if (action === "status") {
  process.stdout.write(`executed: ${result.executed.join(", ") || "none"}\n`);
  process.stdout.write(`pending: ${result.pending.join(", ") || "none"}\n`);
} else {
  process.stdout.write(`applied migrations: ${result.executed.join(", ") || "none"}\n`);
}
