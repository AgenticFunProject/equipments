import { cloneSnapshot } from "./snapshot.js";
import type { StorePersistence, StoreSnapshot } from "./types.js";

export class MemoryPersistence implements StorePersistence {
  private snapshot: StoreSnapshot | null = null;

  load(): StoreSnapshot | null {
    return this.snapshot ? cloneSnapshot(this.snapshot) : null;
  }

  save(snapshot: StoreSnapshot): void {
    this.snapshot = cloneSnapshot(snapshot);
  }
}
