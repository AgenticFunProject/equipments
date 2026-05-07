import { randomUUID } from "node:crypto";

import type { LocalUser } from "../types.js";
import type { ActorIdentity, StoreState } from "./shared.js";

export function findOrCreateUserId(state: StoreState, actor?: ActorIdentity): string | null {
  const issuer = actor?.issuer.trim();
  const subject = actor?.subject.trim();
  if (!issuer || !subject) {
    return null;
  }

  const existing = Array.from(state.users.values()).find((user) => user.issuer === issuer && user.subject === subject);
  if (existing) {
    return existing.id;
  }

  const now = new Date().toISOString();
  const user: LocalUser = {
    id: `usr-${randomUUID()}`,
    externalIdentity: `${issuer}:${subject}`,
    issuer,
    subject,
    displayName: null,
    email: null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now
  };
  state.users.set(user.id, user);
  return user.id;
}
