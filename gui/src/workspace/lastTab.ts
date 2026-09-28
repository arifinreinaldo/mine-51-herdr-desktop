import type { RawTab } from "../appTypes";

/** The workspace that closing `tabId` would also close, or null when the
 * tab is not its workspace's last tab (or is unknown). herdr closes the
 * workspace with its last tab (`src/app/api/tabs.rs`, `closes_workspace`). */
export function workspaceClosedByTabClose(
  tabs: readonly Pick<RawTab, "tab_id" | "workspace_id">[],
  tabId: string,
): string | null {
  const tab = tabs.find((t) => t.tab_id === tabId);
  if (!tab) return null;
  const siblings = tabs.filter((t) => t.workspace_id === tab.workspace_id).length;
  return siblings <= 1 ? tab.workspace_id : null;
}
