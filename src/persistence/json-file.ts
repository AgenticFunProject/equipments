import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isMissingFile, parseSnapshot } from "./snapshot.js";
import type { StorePersistence, StoreSnapshot } from "./types.js";

export class JsonFilePersistence implements StorePersistence {
  constructor(private readonly path: string) {}

  async load(): Promise<StoreSnapshot | null> {
    try {
      const raw = readFileSync(this.path, "utf8");
      if (!raw.trim()) {
        return null;
      }
      return parseSnapshot(raw);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(snapshot), "utf8");
  }
}
