import { randomUUID } from "node:crypto";

import type { AuditEvent } from "../types.js";
import { cloneAuditEvent, type StoreState } from "./shared.js";

export function listAuditEvents(state: StoreState): AuditEvent[] {
  return state.auditEvents.map(cloneAuditEvent);
}

export function recordAuditEvent(state: StoreState, event: Omit<AuditEvent, "id">, persist: () => void): AuditEvent {
  const auditEvent: AuditEvent = {
    id: randomUUID(),
    ...event,
    requestContext: { ...event.requestContext }
  };
  state.auditEvents.push(auditEvent);
  persist();
  return auditEvent;
}
