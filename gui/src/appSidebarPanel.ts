// Sidebar workspace-row rendering (finding #16 extraction from `main.ts`).

import { invoke } from "@tauri-apps/api/core";
import { agentDisplayName } from "./agentText";
import { api, errorMessage, showErrorNotice } from "./appApi";
import { requireConnected } from "./appConnectionGuard";
import { overlayRoot, sidebarEl } from "./appDom";
import { currentThemeDef, tabLabel, updateWorkspaceColorTitlebarVar } from "./appLookups";
import { appState, persistSettings, statusAge } from "./appState";
import { formatAge, newestAgeMs, oldestAgeMs } from "./notifications/statusAge";
import { isRenderGuarded } from "./ui/renderGuard";
import {
  focusSidebarRow,
  renderSidebar,
  sidebarAttention,
  SIDEBAR_RENDER_GUARD_REGION,
  type SidebarAttention,
  type SidebarWorkspace,
  type WorkspaceAgentLine,
} from "./ui/sidebar";
import { assignWorkspaceColors } from "./workspace/colors";
import { prunePersistedFolders } from "./workspace/dedupe";

import { renderTabsNow } from "./appTabStrip";

/** The agents that would stop if a workspace closed (UX pass 1 spec §1
 * "Name what stops"), grouped by `workspace_id`. Only "working" or
 * "blocked" agents belong here. */
export function computeWorkspaceAgentLines(): Map<string, WorkspaceAgentLine[]> {
  const map = new Map<string, WorkspaceAgentLine[]>();
  for (const agent of appState.snapshot?.agents ?? []) {
    if (agent.agent_status !== "working" && agent.agent_status !== "blocked") continue;
    const list = map.get(agent.workspace_id) ?? [];
    list.push({ status: agent.agent_status, tabLabel: tabLabel(agent.tab_id), agentName: agentDisplayName(agent) });
    map.set(agent.workspace_id, list);
  }
  return map;
}

/** UX pass 1 spec §3 "Sidebar line 2 for attention states only": per
 * workspace, the oldest blocked agent's age and the newest done agent's
 * age (both `""` while unknown), grouped by `workspace_id`. Finding #7:
 * also tracks whether the workspace has any *working* agent -- "done"
 * shows only when there is a done agent and no blocked and no working one
 * (otherwise the branch shows, per the spec's literal "only done agents"). */
function computeWorkspaceAttention(): Map<string, SidebarAttention> {
  const now = Date.now();
  const ageMsFor = (paneId: string) => statusAge.ageMs(paneId, now);
  const blockedByWorkspace = new Map<string, string[]>();
  const doneByWorkspace = new Map<string, string[]>();
  const workingWorkspaces = new Set<string>();
  for (const agent of appState.snapshot?.agents ?? []) {
    if (agent.agent_status === "blocked") {
      const list = blockedByWorkspace.get(agent.workspace_id) ?? [];
      list.push(agent.pane_id);
      blockedByWorkspace.set(agent.workspace_id, list);
    } else if (agent.agent_status === "done") {
      const list = doneByWorkspace.get(agent.workspace_id) ?? [];
      list.push(agent.pane_id);
      doneByWorkspace.set(agent.workspace_id, list);
    } else if (agent.agent_status === "working") {
      workingWorkspaces.add(agent.workspace_id);
    }
  }
  const workspaceIds = new Set([...blockedByWorkspace.keys(), ...doneByWorkspace.keys()]);
  const map = new Map<string, SidebarAttention>();
  for (const workspaceId of workspaceIds) {
    const blockedPaneIds = blockedByWorkspace.get(workspaceId) ?? [];
    const donePaneIds = doneByWorkspace.get(workspaceId) ?? [];
    map.set(
      workspaceId,
      sidebarAttention(
        blockedPaneIds.length > 0,
        formatAge(oldestAgeMs(blockedPaneIds, ageMsFor)),
        donePaneIds.length > 0,
        formatAge(newestAgeMs(donePaneIds, ageMsFor)),
        workingWorkspaces.has(workspaceId),
      ),
    );
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
  // UX pass 1 spec §4 "Honest disconnected state": no API calls while
  // disconnected -- the confirm popover may already be open (built from
  // the last known snapshot), but confirming it just shows the notice.
  if (!requireConnected()) return { groupCloseRequired: false };
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
  const attentionByWorkspace = computeWorkspaceAttention();
  const workspaces: SidebarWorkspace[] = snapshot.workspaces.map((w) => ({
    workspace_id: w.workspace_id,
    label: w.label,
    focused: w.focused,
    agent_status: w.agent_status,
    branch: w.branch,
    git_ahead_behind: w.git_ahead_behind,
    worktree_key: w.worktree?.key ?? null,
    attention: attentionByWorkspace.get(w.workspace_id),
  }));
  renderSidebar(
    sidebarEl,
    overlayRoot,
    workspaces,
    computeWorkspaceAgentLines(),
    appState.settings.workspaceColors,
    currentThemeDef().colors,
    {
      onFocusWorkspace: (id) => {
        // UX pass 1 spec §4: "not interactive (no API calls). A click
        // shows the notice 'herdr is not connected'."
        if (!requireConnected()) return;
        void api("workspace.focus", { workspace_id: id });
      },
      onCloseWorkspace: closeWorkspace,
      // Finding #14: inline editing in the sidebar row commits the new
      // label itself -- no `window.prompt` anywhere in this flow.
      onRenameWorkspace: (id, label) => {
        if (!requireConnected()) return;
        void api("workspace.rename", { workspace_id: id, label });
      },
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

/** Ctrl+Shift+E ("focus sidebar", keyboard shortcuts feature): the
 * `appMenuBar.ts` shortcut handler's entry point into the sidebar's own
 * roving-focus DOM logic (`ui/sidebar.ts`'s `focusSidebarRow`). */
export function focusSidebarForKeyboard(): void {
  focusSidebarRow(sidebarEl);
}
