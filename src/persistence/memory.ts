import { cloneSnapshot } from "./snapshot.js";
import type { StorePersistence, StoreSnapshot } from "./types.js";

export class MemoryPersistence implements StorePersistence {
  private snapshot: StoreSnapshot | null = null;

  async load(): Promise<StoreSnapshot | null> {
    return this.snapshot ? cloneSnapshot(this.snapshot) : null;
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    this.snapshot = cloneSnapshot(snapshot);
  }
}
