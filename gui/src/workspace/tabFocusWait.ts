// Waiting for a tab to actually become the connection-focused tab before
// trusting its pane id (spec §1 "(v3 correction)", finding #2 "tab context
// menu Split/Zoom on inactive tab").
//
// `snapshot.panes[].focused` cannot answer "which pane is focused in *this*
// tab": it is true only for the connection-focused pane overall
// (`src/server/client_shell.rs:129`), never per-tab. So for a tab that
// isn't already the focused one, the only trustworthy source is a fresh
// top-level `snapshot.focused_pane_id`, once the server's own snapshot
// catches up to the `tab.focus` call this module waits after.
//
// Extracted from `main.ts` (and kept dependency-injected, not importing
// `@tauri-apps/api/event` directly) so the wait/timeout/race logic is
// unit-testable without a real Tauri runtime.

export interface FocusedTabSnapshot {
  focused_tab_id: string | null;
  focused_pane_id: string | null;
}

export interface TabFocusWaiterDeps {
  /** The current, already-received snapshot (or `null` before the first
   * one ever arrives). */
  getSnapshot(): FocusedTabSnapshot | null;
  /** Subscribes `handler` to every future snapshot; resolves once
   * subscribed (matching `@tauri-apps/api/event`'s `listen()`, which is
   * itself async to attach) to an unsubscribe function. */
  subscribeSnapshot(handler: (snapshot: FocusedTabSnapshot) => void): Promise<() => void>;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export const DEFAULT_TAB_FOCUS_WAIT_MS = 2000;

/**
 * Waits for a snapshot whose `focused_tab_id` is `tabId`, resolving to its
 * `focused_pane_id`, or to `null` after `timeoutMs` with nothing matching.
 * Resolves immediately, with no subscription at all, if the *current*
 * snapshot already matches.
 */
export function waitForTabFocusedPane(
  deps: TabFocusWaiterDeps,
  tabId: string,
  timeoutMs: number = DEFAULT_TAB_FOCUS_WAIT_MS,
): Promise<string | null> {
  const current = deps.getSnapshot();
  if (current?.focused_tab_id === tabId) {
    return Promise.resolve(current.focused_pane_id ?? null);
  }
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      deps.clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };
    const timer = deps.setTimeout(() => finish(null), timeoutMs);
    void deps.subscribeSnapshot((snapshot) => {
      if (snapshot.focused_tab_id === tabId) finish(snapshot.focused_pane_id ?? null);
    }).then((fn) => {
      unsubscribe = fn;
      // The subscription itself is async to attach; a matching snapshot
      // may have already arrived (updating `getSnapshot()`) in the gap
      // between this promise being created and the subscription actually
      // taking effect. Re-check once rather than waiting the full timeout
      // for an event that already happened.
      if (!settled) {
        const recheck = deps.getSnapshot();
        if (recheck?.focused_tab_id === tabId) finish(recheck.focused_pane_id ?? null);
      }
    });
  });
}
