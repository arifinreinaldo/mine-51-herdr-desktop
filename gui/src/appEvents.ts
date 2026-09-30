// Tauri event listener registration, fanning out to the orchestration
// modules that own each concern (finding #16-style extraction, kept out of
// `main.ts` to stay under its own line-count ceiling).

import { listen } from "@tauri-apps/api/event";
import { canvas, titlebarCenterEl } from "./appDom";
import { renderConnectionBanner } from "./appConnectionBanner";
import { refreshMenuBarContext } from "./appMenuBar";
import { appState, doneDetector, statusAge, tabMru } from "./appState";
import { openOrRefreshAgentPopover, refreshAgentPopoverIfOpen, renderStatusBarNow, renderUsageBarNow } from "./appStatusBar";
import { renderTabsNow } from "./appTabStrip";
import { renderSidebarNow } from "./appSidebarPanel";
import type { RawSnapshot, UsageEventPayload } from "./appTypes";
import { handleDoneTransitions, handleSemanticNotification, toDetectionAgents, type RawSemanticNotification } from "./appDoneNotifications";
import { showCopiedNotice } from "./copyNotice";
import { flashFocusedTab } from "./notifications/bellFlash";
import { refreshPaneChrome } from "./paneChrome/paneChrome";
import { formatTitlebarCenter } from "./ui/titlebar";

export async function wireEvents(): Promise<void> {
  await listen<RawSnapshot>("snapshot", (event) => {
    const previousBootId = appState.snapshot?.boot_id;
    const isFirstSnapshot = appState.snapshot === null;
    appState.snapshot = event.payload;
    appState.lastSnapshotAt = Date.now();
    // Keyboard shortcut Alt+`: feed the MRU tracker from every snapshot's
    // focused tab, across all workspaces (not just the current one).
    tabMru.record(appState.snapshot.focused_tab_id);
    // Finding #11: "the next snapshot is authoritative" -- any new
    // snapshot, whether or not it is the one confirming a pending
    // `tab.move`, ends the optimistic reorder window.
    appState.optimisticTabOrder = null;
    if (previousBootId !== undefined && previousBootId !== appState.snapshot.boot_id) {
      doneDetector.resetBaseline();
      statusAge.reset();
    } else {
      handleDoneTransitions(doneDetector.diff(toDetectionAgents()));
    }
    statusAge.update(toDetectionAgents(), appState.lastSnapshotAt);
    renderSidebarNow();
    renderTabsNow();
    // Zoom state comes from the snapshot: the Zoomed badge follows it.
    refreshPaneChrome();
    renderStatusBarNow();
    // UX pass 1 spec §2 refresh (finding #2): keep the open agent
    // popover's rows/ages in sync with each snapshot too, not just the
    // 30s tick below -- without this, a pinned list could show a status
    // that changed several snapshots ago.
    refreshAgentPopoverIfOpen();
    refreshMenuBarContext();
    titlebarCenterEl.textContent = formatTitlebarCenter(
      appState.snapshot.tabs.find((t) => t.focused)?.label ?? null,
      appState.snapshot.workspaces.find((w) => w.focused)?.label ?? null,
    );
    // UX pass 1 spec §3 "the list reopens pinned at startup": deferred to
    // the first real snapshot (rather than true `main()` start) so it has
    // actual agent rows to show, not an empty popover.
    if (isFirstSnapshot && appState.settings.agentListPinned) openOrRefreshAgentPopover(false);
  });
  await listen<UsageEventPayload>("usage", (event) => {
    appState.usagePayload = event.payload;
    renderUsageBarNow();
  });
  await listen<{ status: string; socketPath: string; serverVersion: string | null }>("connection-status", (event) => {
    appState.lastConnectionStatus = event.payload.status;
    if (event.payload.serverVersion) appState.serverVersion = event.payload.serverVersion;
    if (appState.lastConnectionStatus !== "connected") {
      doneDetector.resetBaseline();
      statusAge.reset();
    }
    // Spec §4: the terminal canvas dims alongside the status-bar counts
    // (handled by `renderStatusBarNow` below) while not connected.
    canvas.classList.toggle("is-disconnected", appState.lastConnectionStatus !== "connected");
    renderConnectionBanner(appState.lastConnectionStatus, event.payload.socketPath);
    renderStatusBarNow();
  });
  // OSC 52 clipboard passthrough (`dispatch::handle_clipboard` in the Rust
  // backend, fired by `ServerMessage::Clipboard`): the same "Copied" toast
  // as mouse-selection auto-copy, since both wrote to the same clipboard.
  await listen("clipboard-copied", () => showCopiedNotice());
  // Terminal-parity spec P1 #13 "Bell and notifications".
  await listen<number>("terminal-bell", () => flashFocusedTab());
  await listen<RawSemanticNotification>("semantic-notification", (event) => handleSemanticNotification(event.payload));
}
