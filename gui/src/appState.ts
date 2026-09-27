// The shared, mutable orchestration state every `app*` module reads and
// writes (finding #16 extraction). A single exported `const` object, not
// individually exported `let` bindings: ES modules can't reassign an
// imported `let` from another module, only mutate an imported object's
// own fields, and this state is genuinely shared read/write across
// `main.ts` and its extracted controller modules.

import { errorMessage, showErrorNotice } from "./appApi";
import { debounce } from "./debounce";
import { createEmptyGrid, type Grid } from "./grid";
import { DoneTransitionDetector, HighlightCardStack } from "./notifications/doneDetector";
import { SeenDoneTabsTracker } from "./notifications/seenDoneTabs";
import type { TerminalRenderer } from "./render/renderer";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "./settings";
import { ThemeRegistry } from "./themes/index";
import type { RawSnapshot, UsageEventPayload } from "./appTypes";
import { TabMruTracker } from "./workspace/tabMru";

export const appState = {
  grid: createEmptyGrid() as Grid,
  snapshot: null as RawSnapshot | null,
  /** Finding #11 "Tab drag: optimistic reorder + snap back on error": the
   * tab-id order the strip shows immediately on drop, ahead of the
   * server's own confirming snapshot. Cleared as soon as *any* new
   * snapshot arrives -- "the next snapshot is authoritative" (spec §6) --
   * or the `tab.move` call itself fails. */
  optimisticTabOrder: null as string[] | null,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  themeRegistry: new ThemeRegistry(),
  sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
  resizeDebounceTimer: undefined as number | undefined,
  usagePayload: { five_hour: null, seven_day: null, captured_at: null, status: "missing" } as UsageEventPayload,
  windowFocused: document.hasFocus(),
  lastConnectionStatus: "connecting",
  /** Finding #14 "About shows the server version", from the welcome
   * handshake via the `connection-status` event's `serverVersion` field. */
  serverVersion: null as string | null,
  renderer: null as TerminalRenderer | null,
  agentPopoverCloser: null as (() => void) | null,
  /** Finding #11 "the auto-hide applies only to auto-opened (done)
   * popovers, not user-opened": set only by the two real "open from
   * closed" call sites; a refresh (sort toggle) leaves it as-is. */
  agentPopoverAutoOpened: false,
};

export const doneDetector = new DoneTransitionDetector();
export const seenDoneTabs = new SeenDoneTabsTracker();
/** Keyboard shortcut Alt+` ("toggle to the previously focused tab"): fed by
 * `main.ts`'s snapshot listener, read by `appMenuBar.ts`. */
export const tabMru = new TabMruTracker();
export const highlightCards = new HighlightCardStack();
/** Finding #11 "hover pauses the 8s auto-hide", fed into
 * `HighlightCardStack.prune()`'s `pausedPaneIds`. */
export const hoveredHighlightPaneIds = new Set<string>();

/**
 * Finding #7 "in TS debounce (150ms) + catch errors → notice": several
 * near-simultaneous settings mutations (a sidebar-resize drag-end racing a
 * theme change, say) coalesce into one `settings_set` call instead of one
 * per change, and a failed save shows a notice instead of the previous
 * silent `void saveSettings(...)` swallowing the rejection outright.
 */
const debouncedSave = debounce(() => {
  void saveSettings(appState.settings).catch((err: unknown) => {
    showErrorNotice(errorMessage(err));
  });
}, 150);

export function persistSettings(): void {
  debouncedSave();
}
