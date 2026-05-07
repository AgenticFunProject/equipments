import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StorageBackend } from "../src/persistence/index.js";
import { createStoreFromRuntimeConfig } from "../src/store.js";
import {
  loadUserEventsConfig,
  parseUserEventMessage,
  USER_EVENTS_KAFKA_BROKERS_ENV,
  USER_EVENTS_KAFKA_FROM_BEGINNING_ENV,
  USER_EVENTS_KAFKA_TOPIC_ENV
} from "../src/user-events.js";

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("loadUserEventsConfig returns null when Kafka sync is disabled", () => {
  assert.equal(loadUserEventsConfig({}), null);
});

test("loadUserEventsConfig parses broker and topic settings", () => {
  const config = loadUserEventsConfig({
    [USER_EVENTS_KAFKA_BROKERS_ENV]: "broker-a:9092, broker-b:9092",
    [USER_EVENTS_KAFKA_TOPIC_ENV]: "users.events",
    [USER_EVENTS_KAFKA_FROM_BEGINNING_ENV]: "true"
  });

  assert.deepEqual(config, {
    brokers: ["broker-a:9092", "broker-b:9092"],
    topic: "users.events",
    groupId: "equipments-user-sync",
    clientId: "equipments-service",
    fromBeginning: true
  });
});

test("parseUserEventMessage reads supported envelopes", () => {
  const event = parseUserEventMessage(
    JSON.stringify({
      eventType: "user.updated",
      payload: {
        id: "usr-platform-1",
        issuer: "platform-auth",
        subject: "ops-agent",
        displayName: "Ops Agent",
        email: "ops-agent@example.com",
        status: "active",
        updatedAt: "2026-05-07T13:00:00.000Z"
      }
    })
  );

  assert.deepEqual(event, {
    eventType: "user.updated",
    user: {
      id: "usr-platform-1",
      externalIdentity: undefined,
      issuer: "platform-auth",
      subject: "ops-agent",
      displayName: "Ops Agent",
      email: "ops-agent@example.com",
      status: "active",
      createdAt: undefined,
      updatedAt: "2026-05-07T13:00:00.000Z"
    }
  });
});

test("parseUserEventMessage ignores unsupported event types", () => {
  const event = parseUserEventMessage(
    JSON.stringify({
      eventType: "user.deleted",
      payload: {
        id: "usr-platform-1",
        issuer: "platform-auth",
        subject: "ops-agent"
      }
    })
  );

  assert.equal(event, null);
});

test("upsertLocalUser updates existing records idempotently", () => {
  const store = createStoreFromRuntimeConfig({ backend: StorageBackend.MEMORY, path: "" }, false);

  const created = store.upsertLocalUser({
    id: "usr-platform-1",
    issuer: "platform-auth",
    subject: "ops-agent",
    displayName: "Ops Agent",
    email: "ops-agent@example.com",
    status: "ACTIVE",
    createdAt: "2026-05-07T12:00:00.000Z",
    updatedAt: "2026-05-07T12:00:00.000Z"
  });
  const updated = store.upsertLocalUser({
    id: "usr-platform-1",
    issuer: "platform-auth",
    subject: "ops-agent",
    displayName: "Operations Agent",
    email: "ops@example.com",
    status: "inactive",
    updatedAt: "2026-05-07T13:00:00.000Z"
  });

  assert.equal(created.id, updated.id);
  assert.equal(store.listUsers().length, 1);
  assert.deepEqual(store.listUsers()[0], {
    id: "usr-platform-1",
    externalIdentity: "platform-auth:ops-agent",
    issuer: "platform-auth",
    subject: "ops-agent",
    displayName: "Operations Agent",
    email: "ops@example.com",
    status: "INACTIVE",
    createdAt: "2026-05-07T12:00:00.000Z",
    updatedAt: "2026-05-07T13:00:00.000Z"
  });
});

test("sqlite persistence keeps synced users across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "equipments-user-events-"));
  try {
    const path = join(dir, "equipments.sqlite");
    const storeA = createStoreFromRuntimeConfig({ backend: StorageBackend.SQLITE, path }, false);
    storeA.upsertLocalUser({
      id: "usr-platform-2",
      issuer: "platform-auth",
      subject: "planner",
      displayName: "Planner",
      email: "planner@example.com",
      status: "ACTIVE",
      createdAt: "2026-05-07T12:30:00.000Z",
      updatedAt: "2026-05-07T12:30:00.000Z"
    });

    const storeB = createStoreFromRuntimeConfig({ backend: StorageBackend.SQLITE, path }, false);
    assert.deepEqual(normalize(storeB.listUsers()), [
      {
        id: "usr-platform-2",
        externalIdentity: "platform-auth:planner",
        issuer: "platform-auth",
        subject: "planner",
        displayName: "Planner",
        email: "planner@example.com",
        status: "ACTIVE",
        createdAt: "2026-05-07T12:30:00.000Z",
        updatedAt: "2026-05-07T12:30:00.000Z"
      }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
