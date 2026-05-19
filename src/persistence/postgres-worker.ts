import { parentPort, workerData, type MessagePort } from "node:worker_threads";

import { createSeedAuthorizationRules } from "../authorization-rules.js";
import { assertPostgresSchemaReady, loadPostgresSnapshot, writePostgresSnapshot, type PgPoolLike } from "./postgres.js";
import type { StoreSnapshot } from "./types.js";

interface PostgresWorkerData {
  connectionString: string;
  responsePort: MessagePort;
}

interface PostgresWorkerRequest {
  id: number;
  command: "assert-ready" | "load" | "save";
  signal: SharedArrayBuffer;
  snapshot?: StoreSnapshot;
}

const { connectionString, responsePort } = workerData as PostgresWorkerData;
const port = parentPort;

if (!port) {
  throw new Error("postgres worker requires a parent port");
}

const { Pool } = await import("pg");
const pool: PgPoolLike = new Pool({ connectionString });

port.on("message", (request: PostgresWorkerRequest) => {
  void handleRequest(request);
});

async function handleRequest(request: PostgresWorkerRequest): Promise<void> {
  const signal = new Int32Array(request.signal);

  try {
    if (request.command === "assert-ready") {
      await assertPostgresSchemaReady(pool);
      responsePort.postMessage({ id: request.id, ok: true });
      return;
    }

    const client = await pool.connect();
    try {
      if (request.command === "load") {
        const snapshot = await loadPostgresSnapshot(client);
        responsePort.postMessage({ id: request.id, ok: true, result: snapshot });
        return;
      }

      await writePostgresSnapshot(client, request.snapshot ?? emptySnapshot());
      responsePort.postMessage({ id: request.id, ok: true });
    } finally {
      client.release();
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    responsePort.postMessage({
      id: request.id,
      ok: false,
      error: {
        message: failure.message,
        statusCode: "statusCode" in failure && typeof failure.statusCode === "number" ? failure.statusCode : 500
      }
    });
  } finally {
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
  }
}

function emptySnapshot(): StoreSnapshot {
  return {
    auditEvents: [],
    authorizationRules: createSeedAuthorizationRules(),
    equipmentTypes: [],
    users: [],
    containers: [],
    reservations: []
  };
}
