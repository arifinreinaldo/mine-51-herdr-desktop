// One fan-out point for herdr snapshots. `appEvents.ts` owns the single Tauri
// `snapshot` listener and calls `publishSnapshot`; the other modules subscribe here.
import type { RawSnapshot } from "./appTypes";

export type SnapshotHandler = (snapshot: RawSnapshot) => void;

export function createSnapshotBus(): {
  subscribe(handler: SnapshotHandler): () => void;
  publish(snapshot: RawSnapshot): void;
} {
  const handlers = new Set<SnapshotHandler>();
  return {
    subscribe(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    publish(snapshot) {
      // A copy, so a handler may unsubscribe during delivery; one throwing handler must not starve the rest.
      for (const handler of [...handlers]) {
        try {
          handler(snapshot);
        } catch (err) {
          console.error("snapshot subscriber failed:", err);
        }
      }
    },
  };
}

const bus = createSnapshotBus();
export const subscribeSnapshot = bus.subscribe;
export const publishSnapshot = bus.publish;
