import { Kafka, logLevel } from "kafkajs";

import { DomainError } from "./errors.js";
import type { EquipmentsStore } from "./store.js";
import type { UpsertLocalUserInput } from "./store/users.js";

export const USER_EVENTS_KAFKA_BROKERS_ENV = "USER_EVENTS_KAFKA_BROKERS";
export const USER_EVENTS_KAFKA_TOPIC_ENV = "USER_EVENTS_KAFKA_TOPIC";
export const USER_EVENTS_KAFKA_GROUP_ID_ENV = "USER_EVENTS_KAFKA_GROUP_ID";
export const USER_EVENTS_KAFKA_CLIENT_ID_ENV = "USER_EVENTS_KAFKA_CLIENT_ID";
export const USER_EVENTS_KAFKA_FROM_BEGINNING_ENV = "USER_EVENTS_KAFKA_FROM_BEGINNING";

const SUPPORTED_USER_EVENT_TYPES = new Set(["user.created", "user.updated", "user.changed"]);

export interface UserEventsConfig {
  brokers: string[];
  topic: string;
  groupId: string;
  clientId: string;
  fromBeginning: boolean;
}

export interface UserEventConsumer {
  stop(): Promise<void>;
}

interface UserEventEnvelope {
  eventType: string;
  user: UpsertLocalUserInput;
}

export function loadUserEventsConfig(env = process.env): UserEventsConfig | null {
  const brokers = splitCsv(env[USER_EVENTS_KAFKA_BROKERS_ENV]);
  const topic = env[USER_EVENTS_KAFKA_TOPIC_ENV]?.trim() ?? "";
  if (!brokers.length && !topic) {
    return null;
  }
  if (!brokers.length) {
    throw new DomainError(`${USER_EVENTS_KAFKA_BROKERS_ENV} is required when ${USER_EVENTS_KAFKA_TOPIC_ENV} is set`);
  }
  if (!topic) {
    throw new DomainError(`${USER_EVENTS_KAFKA_TOPIC_ENV} is required when ${USER_EVENTS_KAFKA_BROKERS_ENV} is set`);
  }

  return {
    brokers,
    topic,
    groupId: env[USER_EVENTS_KAFKA_GROUP_ID_ENV]?.trim() || "equipments-user-sync",
    clientId: env[USER_EVENTS_KAFKA_CLIENT_ID_ENV]?.trim() || "equipments-service",
    fromBeginning: parseBooleanFlag(env[USER_EVENTS_KAFKA_FROM_BEGINNING_ENV])
  };
}

export async function startUserEventsConsumer(store: EquipmentsStore, env = process.env): Promise<UserEventConsumer | null> {
  const config = loadUserEventsConfig(env);
  if (!config) {
    return null;
  }

  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    logLevel: logLevel.NOTHING
  });
  const consumer = kafka.consumer({ groupId: config.groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: config.topic, fromBeginning: config.fromBeginning });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const payload = message.value?.toString("utf8") ?? "";

      try {
        const event = parseUserEventMessage(payload);
        if (!event) {
          return;
        }

        store.upsertLocalUser(event.user);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `failed to process user event from ${topic}[${partition}] offset ${message.offset}: ${reason}\n`
        );
      }
    }
  });

  process.stdout.write(`user event sync listening on Kafka topic ${config.topic}\n`);

  return {
    async stop() {
      await consumer.disconnect();
    }
  };
}

export function parseUserEventMessage(payload: string): UserEventEnvelope | null {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new DomainError("user event payload is empty");
  }

  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const eventType = normalizeOptionalString(readString(parsed.eventType) ?? readString(parsed.type)) ?? "user.changed";
  if (!SUPPORTED_USER_EVENT_TYPES.has(eventType)) {
    return null;
  }

  const rawUser = extractUserRecord(parsed);
  const issuer = readRequiredString(rawUser, ["issuer"]);
  const subject = readRequiredString(rawUser, ["subject"]);
  const createdAt = readString(rawUser.createdAt) ?? readString(rawUser.occurredAt) ?? readString(rawUser.timestamp);
  const updatedAt = readString(rawUser.updatedAt) ?? readString(rawUser.occurredAt) ?? readString(rawUser.timestamp) ?? createdAt;

  return {
    eventType,
    user: {
      id: readRequiredString(rawUser, ["id", "userId"]),
      externalIdentity: readString(rawUser.externalIdentity) ?? undefined,
      issuer,
      subject,
      displayName: readNullableString(rawUser.displayName) ?? readNullableString(rawUser.name),
      email: readNullableString(rawUser.email),
      status: readString(rawUser.status) ?? undefined,
      createdAt: createdAt ?? undefined,
      updatedAt: updatedAt ?? undefined
    }
  };
}

function extractUserRecord(parsed: Record<string, unknown>): Record<string, unknown> {
  const nested = parsed.payload ?? parsed.data ?? parsed.user;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  return parsed;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanFlag(value: string | undefined): boolean {
  switch (value?.trim().toLowerCase()) {
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
      throw new DomainError(`unsupported boolean flag value ${JSON.stringify(value)}`);
  }
}

function readRequiredString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }

  throw new DomainError(`user event is missing ${keys[0]}`);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return readString(value) ?? undefined;
}

function normalizeOptionalString(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
