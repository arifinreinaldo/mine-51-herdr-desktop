// Closing a pane. herdr closes the workspace when the last pane of the last
// tab closes, and closing a pane stops its agent. So the last pane of the
// last tab goes through `requestCloseTab`, and a working or blocked agent
// asks first (same safe confirm: Cancel focused).

import { api } from "./appApi";
import { canvas, overlayRoot } from "./appDom";
import { appState } from "./appState";
import { requestCloseTab } from "./tabClose";
import { openConfirmPopover } from "./ui/confirmPopover";
import { paneCloseDecision, paneCloseDetail } from "./workspace/paneClose";

/** Close a pane; a pane with a working or blocked agent confirms first. */
export function requestClosePane(paneId: string, anchor?: HTMLElement | null): void {
  const snap = appState.snapshot;
  const decision = paneCloseDecision(paneId, {
    panes: snap?.panes ?? [],
    tabs: snap?.tabs ?? [],
    agents: snap?.agents ?? [],
  });
  if (decision.kind === "closeTab") {
    requestCloseTab(decision.tabId, anchor);
    return;
  }
  if (decision.kind === "close") {
    void api("pane.close", { pane_id: paneId });
    return;
  }
  openConfirmPopover(overlayRoot, anchor ?? canvas, {
    titlePrefix: "Close the pane running ",
    titleName: decision.agentName,
    titleSuffix: "?",
    detail: paneCloseDetail(decision.agentName, decision.status),
    confirmLabel: "Close pane",
    onConfirm: () => {
      void api("pane.close", { pane_id: paneId });
    },
  });
}
