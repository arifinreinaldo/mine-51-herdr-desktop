// Closing a tab. herdr closes the whole workspace when its last tab closes
// (`src/app/api/tabs.rs` handle_tab_close: `closes_workspace = ws.tabs.len() <= 1`),
// which also stops every agent in it. So the last tab asks first, with the
// same safe confirm as closing a workspace (Cancel focused, agents named).

import { api } from "./appApi";
import { overlayRoot, tabListEl } from "./appDom";
import { workspaceLabel } from "./appLookups";
import { computeWorkspaceAgentLines } from "./appSidebarPanel";
import { appState } from "./appState";
import { workspaceClosedByTabClose } from "./workspace/lastTab";
import { openConfirmPopover } from "./ui/confirmPopover";
import { closeConfirmAgentLines, closeDetailText } from "./ui/sidebar";

function tabElement(tabId: string): HTMLElement | null {
  for (const el of Array.from(tabListEl.querySelectorAll<HTMLElement>(".tab"))) {
    if (el.dataset.tabId === tabId) return el;
  }
  return null;
}

/** Close a tab; the last tab of a workspace confirms first. */
export function requestCloseTab(tabId: string, anchor?: HTMLElement | null): void {
  const workspaceId = workspaceClosedByTabClose(appState.snapshot?.tabs ?? [], tabId);
  if (!workspaceId) {
    void api("tab.close", { tab_id: tabId });
    return;
  }
  const agents = computeWorkspaceAgentLines().get(workspaceId) ?? [];
  const counts = {
    working: agents.filter((a) => a.status === "working").length,
    blocked: agents.filter((a) => a.status === "blocked").length,
  };
  openConfirmPopover(overlayRoot, anchor ?? tabElement(tabId) ?? tabListEl, {
    titlePrefix: "Close the last tab of ",
    titleName: workspaceLabel(workspaceId),
    titleSuffix: "?",
    detail: `This also closes the workspace. ${closeDetailText(counts)}`,
    agentLines: closeConfirmAgentLines(agents),
    confirmLabel: "Close workspace",
    onConfirm: () => {
      void api("tab.close", { tab_id: tabId });
    },
  });
}
