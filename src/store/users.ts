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

  const user: LocalUser = {
    id: `usr-${randomUUID()}`,
    issuer,
    subject,
    createdAt: new Date().toISOString()
  };
  state.users.set(user.id, user);
  return user.id;
}
