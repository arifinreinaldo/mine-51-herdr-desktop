// Deferring a full DOM rebuild while something time-sensitive is in
// progress inside it (finding #5): every snapshot re-renders the tab strip
// and the sidebar from scratch, which destroys an in-progress inline
// rename `<input>` (losing whatever the user had typed and dropping
// keyboard focus) and a tab drag's local `drag` state (a fresh
// `renderTabStrip` call creates a brand new closure with `drag: null`,
// breaking `dragover`/`drop` mid-drag).
//
// A named counter per region ("tabs", "sidebar") rather than one global
// flag: an inline rename in the sidebar (finding #14 reuses this same
// rename component there) must not block the tab strip's own re-render,
// and vice versa.

const activeCounts = new Map<string, number>();
const releaseListeners = new Map<string, () => void>();

/** Marks `region` as guarded; returns a release function. Safe to call
 * more than once concurrently for the same region (a counter, not a
 * boolean) -- the region is only unguarded once every caller has released. */
export function beginRenderGuard(region: string): () => void {
  activeCounts.set(region, (activeCounts.get(region) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeCounts.get(region) ?? 1) - 1;
    if (next <= 0) {
      activeCounts.delete(region);
      releaseListeners.get(region)?.();
    } else {
      activeCounts.set(region, next);
    }
  };
}

export function isRenderGuarded(region: string): boolean {
  return (activeCounts.get(region) ?? 0) > 0;
}

/**
 * Registers the single callback fired once `region` becomes fully
 * unguarded (every `beginRenderGuard(region)` call for it has released).
 * The caller (`main.ts`) re-renders using whatever snapshot arrived most
 * recently while deferred -- there is nothing to "replay": the latest data
 * was already applied to the module's own state throughout, only the DOM
 * rebuild was skipped.
 */
export function onRenderGuardReleased(region: string, listener: (() => void) | null): void {
  if (listener) releaseListeners.set(region, listener);
  else releaseListeners.delete(region);
}
