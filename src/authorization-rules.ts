import { Scope } from "./auth.js";
import type { AuthorizationRule } from "./types.js";

type AuthorizationRuleDefinition = Omit<AuthorizationRule, "createdAt" | "updatedAt">;

const AUTHORIZATION_RULE_DEFINITIONS: AuthorizationRuleDefinition[] = [
  publicRule("GET", "/", "PlaygroundController", "redirectToPlayground", "playground"),
  publicRule("GET", "/playground", "PlaygroundController", "render", "playground"),
  publicRule("GET", "/playground/playground.css", "PlaygroundController", "stylesheet", "playground_asset"),
  publicRule("GET", "/playground/playground.js", "PlaygroundController", "script", "playground_asset"),
  publicRule("GET", "/health", "ServiceController", "health", "service"),
  publicRule("GET", "/openapi.json", "ServiceController", "openapi", "service"),
  protectedRule("GET", "/equipment-types", "EquipmentTypesController", "list", "equipment_type", Scope.READ),
  protectedRule("POST", "/equipment-types", "EquipmentTypesController", "create", "equipment_type", Scope.MODIFY),
  protectedRule("PUT", "/equipment-types/:code", "EquipmentTypesController", "update", "equipment_type", Scope.MODIFY),
  protectedRule("POST", "/containers", "ContainersController", "register", "container", Scope.MODIFY),
  protectedRule("GET", "/containers", "ContainersController", "list", "container", Scope.READ),
  protectedRule("GET", "/containers/:id", "ContainersController", "get", "container", Scope.READ),
  protectedRule("PATCH", "/containers/:id/status", "ContainersController", "overrideStatus", "container", Scope.MODIFY),
  protectedRule("GET", "/availability", "AvailabilityController", "get", "availability", Scope.READ),
  protectedRule("POST", "/reservations", "ReservationsController", "create", "reservation", Scope.MODIFY),
  protectedRule("DELETE", "/reservations/:bookingReference", "ReservationsController", "release", "reservation", Scope.MODIFY),
  protectedRule("POST", "/containers/:id/pickup", "ContainersController", "pickup", "container", Scope.MODIFY),
  protectedRule("POST", "/containers/:id/return", "ContainersController", "return", "container", Scope.MODIFY),
  protectedRule("POST", "/events", "EventsController", "consume", "event", Scope.MODIFY),
  protectedRule("POST", "/dev/reset-all-data", "DevController", "resetAllData", "store", Scope.MODIFY),
  protectedRule("POST", "/dev/clear-all-data", "DevController", "clearAllData", "store", Scope.MODIFY),
  publicRule("POST", "/dev/generate-token", "DevController", "generateToken", "auth_token")
];

export function createSeedAuthorizationRules(timestamp = new Date().toISOString()): AuthorizationRule[] {
  return AUTHORIZATION_RULE_DEFINITIONS.map((definition) => ({
    ...definition,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

export function cloneAuthorizationRule(rule: AuthorizationRule): AuthorizationRule {
  return { ...rule };
}

function publicRule(
  method: string,
  pathPattern: string,
  controller: string,
  action: string,
  resourceType: string
): AuthorizationRuleDefinition {
  return {
    routeKey: routeKey(method, pathPattern),
    method,
    pathPattern,
    controller,
    action,
    resourceType,
    requiredScope: null,
    adminAccepted: false,
    public: true
  };
}

function protectedRule(
  method: string,
  pathPattern: string,
  controller: string,
  action: string,
  resourceType: string,
  requiredScope: string
): AuthorizationRuleDefinition {
  return {
    routeKey: routeKey(method, pathPattern),
    method,
    pathPattern,
    controller,
    action,
    resourceType,
    requiredScope,
    adminAccepted: true,
    public: false
  };
}

function routeKey(method: string, pathPattern: string): string {
  return `${method.toUpperCase()} ${pathPattern}`;
}
