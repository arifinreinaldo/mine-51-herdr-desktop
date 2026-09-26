// Sidebar workspace-row rendering (finding #16 extraction from `main.ts`).

import { invoke } from "@tauri-apps/api/core";
import { api, errorMessage, showErrorNotice } from "./appApi";
import { overlayRoot, sidebarEl } from "./appDom";
import { currentThemeDef, updateWorkspaceColorTitlebarVar } from "./appLookups";
import { appState, persistSettings } from "./appState";
import { isRenderGuarded } from "./ui/renderGuard";
import { renderSidebar, SIDEBAR_RENDER_GUARD_REGION, type SidebarWorkspace, type WorkspaceAgentCounts } from "./ui/sidebar";
import { assignWorkspaceColors } from "./workspace/colors";
import { prunePersistedFolders } from "./workspace/dedupe";

import { renderTabsNow } from "./appTabStrip";

function computeAgentCountsByWorkspace(): Map<string, WorkspaceAgentCounts> {
  const map = new Map<string, WorkspaceAgentCounts>();
  for (const agent of appState.snapshot?.agents ?? []) {
    const entry = map.get(agent.workspace_id) ?? { working: 0, blocked: 0 };
    if (agent.agent_status === "working") entry.working++;
    if (agent.agent_status === "blocked") entry.blocked++;
    map.set(agent.workspace_id, entry);
  }
  return map;
}

function updateWorkspaceColorAssignment(): void {
  const snapshot = appState.snapshot;
  if (!snapshot) return;
  const liveIds = snapshot.workspaces.map((w) => w.workspace_id);
  const next = assignWorkspaceColors(liveIds, appState.settings.workspaceColors);
  const changed = JSON.stringify(next) !== JSON.stringify(appState.settings.workspaceColors);
  appState.settings.workspaceFolders = prunePersistedFolders(appState.settings.workspaceFolders, liveIds);
  if (changed) {
    appState.settings.workspaceColors = next as Record<string, number>;
    persistSettings();
  }
}

async function closeWorkspace(workspaceId: string, closeGroup: boolean): Promise<{ groupCloseRequired: boolean }> {
  try {
    await invoke("api", { method: "workspace.close", params: { workspace_id: workspaceId, close_group: closeGroup } });
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "workspace_group_close_required") {
      return { groupCloseRequired: true };
    }
    showErrorNotice(errorMessage(err));
  }
  return { groupCloseRequired: false };
}

export function renderSidebarNow(): void {
  // Finding #5/#14: a snapshot mid-rename must not rebuild the sidebar --
  // same reasoning as `renderTabsNow`'s own guard.
  if (isRenderGuarded(SIDEBAR_RENDER_GUARD_REGION)) return;
  const snapshot = appState.snapshot;
  if (!snapshot) return;
  updateWorkspaceColorAssignment();
  const workspaces: SidebarWorkspace[] = snapshot.workspaces.map((w) => ({
    workspace_id: w.workspace_id,
    label: w.label,
    focused: w.focused,
    agent_status: w.agent_status,
    branch: w.branch,
    git_ahead_behind: w.git_ahead_behind,
    worktree_key: w.worktree?.key ?? null,
  }));
  renderSidebar(
    sidebarEl,
    overlayRoot,
    workspaces,
    computeAgentCountsByWorkspace(),
    appState.settings.workspaceColors,
    currentThemeDef().colors,
    {
      onFocusWorkspace: (id) => void api("workspace.focus", { workspace_id: id }),
      onCloseWorkspace: closeWorkspace,
      // Finding #14: inline editing in the sidebar row commits the new
      // label itself -- no `window.prompt` anywhere in this flow.
      onRenameWorkspace: (id, label) => void api("workspace.rename", { workspace_id: id, label }),
      onChangeColor: (id, index) => {
        appState.settings.workspaceColors = { ...appState.settings.workspaceColors, [id]: index };
        persistSettings();
        renderSidebarNow();
        updateWorkspaceColorTitlebarVar();
        renderTabsNow();
      },
    },
  );
  updateWorkspaceColorTitlebarVar();
}
