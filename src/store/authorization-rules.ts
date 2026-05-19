import { cloneAuthorizationRule } from "../authorization-rules.js";
import type { AuthorizationRule } from "../types.js";
import type { StoreState } from "./shared.js";

export function listAuthorizationRules(state: StoreState): AuthorizationRule[] {
  return Array.from(state.authorizationRules.values())
    .map(cloneAuthorizationRule)
    .sort((left, right) => left.routeKey.localeCompare(right.routeKey));
}
