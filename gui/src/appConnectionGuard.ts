// Guards the sidebar/tab-strip interactions that would otherwise make an
// API call while herdr is not connected (UX pass 1 spec §4 "Honest
// disconnected state": "not interactive (no API calls). A click shows the
// notice 'herdr is not connected'"). Kept as its own tiny module rather
// than added to `appApi.ts` because `appState.ts` already imports from
// `appApi.ts` -- `appApi.ts` importing `appState` back would be circular.

import { showErrorNotice } from "./appApi";
import { appState } from "./appState";

/** Returns `true` when connected. Otherwise shows the "not connected"
 * notice and returns `false`, so a call site can write
 * `if (!requireConnected()) return;` before an API call. */
export function requireConnected(): boolean {
  if (appState.lastConnectionStatus === "connected") return true;
  showErrorNotice("herdr is not connected");
  return false;
}
