import { DomainError } from "../errors.js";
import type { EquipmentType } from "../types.js";
import { nextTimestamp, type ActorIdentity, type StoreState } from "./shared.js";

export function listEquipmentTypes(state: StoreState): EquipmentType[] {
  return Array.from(state.equipmentTypes.values());
}

export function createEquipmentType(
  state: StoreState,
  input: Omit<EquipmentType, "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): EquipmentType {
  const code = input.code.trim().toUpperCase();
  if (!code) {
    throw new DomainError("equipment type code is required");
  }
  if (state.equipmentTypes.has(code)) {
    throw new DomainError(`equipment type ${code} already exists`, 409);
  }

  const now = new Date().toISOString();
  const actorUserId = findOrCreateUserId(actor);
  const equipmentType: EquipmentType = {
    code,
    description: input.description.trim(),
    nominalLength: input.nominalLength.trim(),
    maxPayloadKg: input.maxPayloadKg,
    createdByUserId: actorUserId,
    lastModifiedByUserId: actorUserId,
    createdAt: now,
    updatedAt: now
  };
  validateEquipmentType(equipmentType);
  state.equipmentTypes.set(code, equipmentType);
  persist();
  return equipmentType;
}

export function updateEquipmentType(
  state: StoreState,
  code: string,
  input: Partial<Omit<EquipmentType, "code" | "createdByUserId" | "lastModifiedByUserId" | "createdAt" | "updatedAt">>,
  actor: ActorIdentity | undefined,
  findOrCreateUserId: (actor?: ActorIdentity) => string | null,
  persist: () => void
): EquipmentType {
  const key = code.trim().toUpperCase();
  const current = state.equipmentTypes.get(key);
  if (!current) {
    throw new DomainError(`equipment type ${key} not found`, 404);
  }

  const now = nextTimestamp(current.updatedAt);
  const next: EquipmentType = {
    code: current.code,
    description: input.description?.trim() ?? current.description,
    nominalLength: input.nominalLength?.trim() ?? current.nominalLength,
    maxPayloadKg: input.maxPayloadKg ?? current.maxPayloadKg,
    createdByUserId: current.createdByUserId,
    lastModifiedByUserId: findOrCreateUserId(actor),
    createdAt: current.createdAt,
    updatedAt: now
  };
  validateEquipmentType(next);
  state.equipmentTypes.set(key, next);
  persist();
  return next;
}

export function validateEquipmentType(equipmentType: EquipmentType): void {
  if (!equipmentType.description) {
    throw new DomainError("description is required");
  }
  if (!equipmentType.nominalLength) {
    throw new DomainError("nominalLength is required");
  }
  if (!Number.isFinite(equipmentType.maxPayloadKg) || equipmentType.maxPayloadKg <= 0) {
    throw new DomainError("maxPayloadKg must be a positive number");
  }
}
