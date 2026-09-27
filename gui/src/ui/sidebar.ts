// Sidebar: workspace rows (spec phase1.5 §5 "Sidebar", §6a "Workspace
// colours"). No nested tabs, no agents section, no collapsible groups --
// one flat row per workspace.

import { focusKeyboardCapture, keyboardCaptureReturnTarget } from "../keyboard/focusCapture";
import { DIRECT_FOCUS_SLOT_COUNT } from "../shortcuts";
import { resolveWorkspacePaletteColor, type ThemeColors } from "../themes/tokens";
import { LAST_FOCUS_SHORTCUT_DIGIT } from "../workspace/focusByIndex";
import { openConfirmPopover } from "./confirmPopover";
import type { MenuItemSpec } from "./menu";
import { openMenu } from "./menu";
import { startInlineRename } from "./tabs";

/** Finding #5/#14: the render-guard region a workspace inline rename
 * claims, reusing `tabs.ts`'s `startInlineRename` component but under its
 * own region -- a sidebar rename must not block the tab strip's
 * re-render, and vice versa. `main.ts` imports `isRenderGuarded` directly
 * from `./renderGuard` and uses this region name with it. */
export const SIDEBAR_RENDER_GUARD_REGION = "sidebar";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface SidebarWorkspace {
  workspace_id: string;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
  branch: string | null;
  git_ahead_behind: [number, number] | null;
  /** Present only for a workspace that is part of a linked-worktree group
   * (spec §5 "close_group"). */
  worktree_key: string | null;
}

export interface WorkspaceAgentCounts {
  working: number;
  blocked: number;
}

export interface SidebarCallbacks {
  onFocusWorkspace(workspaceId: string): void;
  /** `closeGroup` is `true` only on the retry after a
   * `workspace_group_close_required` error (spec §5). */
  onCloseWorkspace(workspaceId: string, closeGroup: boolean): Promise<{ groupCloseRequired: boolean }>;
  /** Finding #14: `label` is the already-committed new name (the inline
   * rename UI, not a `window.prompt`, lives in this module now). */
  onRenameWorkspace(workspaceId: string, label: string): void;
  onChangeColor(workspaceId: string, index: number): void;
}

function statusDotClass(status: AgentStatus): string {
  return `status-dot status-dot--${status}`;
}

function agentCountsFor(
  workspaceId: string,
  counts: ReadonlyMap<string, WorkspaceAgentCounts>,
): WorkspaceAgentCounts {
  return counts.get(workspaceId) ?? { working: 0, blocked: 0 };
}

function linkedWorktreeCount(workspace: SidebarWorkspace, all: readonly SidebarWorkspace[]): number {
  if (!workspace.worktree_key) return 0;
  return all.filter((w) => w.worktree_key === workspace.worktree_key && w.workspace_id !== workspace.workspace_id)
    .length;
}

async function handleCloseConfirmed(
  workspace: SidebarWorkspace,
  callbacks: SidebarCallbacks,
  overlayRoot: HTMLElement,
  rowEl: HTMLElement,
  all: readonly SidebarWorkspace[],
): Promise<void> {
  const result = await callbacks.onCloseWorkspace(workspace.workspace_id, false);
  if (!result.groupCloseRequired) return;
  const count = linkedWorktreeCount(workspace, all);
  const suffix = count > 0 ? `Also close ${count} linked worktree workspaces?` : "Also close the linked worktree workspaces?";
  openConfirmPopover(overlayRoot, rowEl, {
    titlePrefix: suffix,
    titleName: "",
    detail: "",
    confirmLabel: "Close",
    onConfirm: () => {
      void callbacks.onCloseWorkspace(workspace.workspace_id, true);
    },
  });
}

function renderRow(
  workspace: SidebarWorkspace,
  all: readonly SidebarWorkspace[],
  overlayRoot: HTMLElement,
  colorIndex: number | undefined,
  theme: ThemeColors,
  callbacks: SidebarCallbacks,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "ws";
  row.setAttribute("role", "option");
  row.tabIndex = 0;
  row.dataset.workspaceId = workspace.workspace_id;
  if (workspace.focused) row.classList.add("is-selected");
  if (workspace.agent_status === "blocked") row.classList.add("is-blocked");
  row.setAttribute("aria-selected", String(workspace.focused));

  const dot = document.createElement("span");
  dot.className = statusDotClass(workspace.agent_status);
  row.appendChild(dot);

  const nameRow = document.createElement("div");
  nameRow.className = "ws-name-row";
  if (colorIndex !== undefined) {
    const chip = document.createElement("span");
    chip.className = "ws-chip";
    chip.style.background = resolveWorkspacePaletteColor(colorIndex, theme);
    nameRow.appendChild(chip);
  }
  const name = document.createElement("span");
  name.className = "ws-name";
  name.textContent = workspace.label;
  nameRow.appendChild(name);
  row.appendChild(nameRow);

  const meta = document.createElement("div");
  meta.className = "ws-meta";
  if (workspace.branch) {
    const branchIcon = document.createElement("i");
    branchIcon.className = "codicon codicon-git-branch";
    meta.appendChild(branchIcon);
    const branchLabel = document.createElement("span");
    branchLabel.textContent = workspace.branch;
    meta.appendChild(branchLabel);
    const [ahead, behind] = workspace.git_ahead_behind ?? [0, 0];
    if (ahead > 0 || behind > 0) {
      const ab = document.createElement("span");
      ab.className = "ws-ahead-behind";
      ab.textContent = `${ahead > 0 ? `↑${ahead} ` : ""}${behind > 0 ? `↓${behind}` : ""}`.trim();
      meta.appendChild(ab);
    }
  } else {
    const folderIcon = document.createElement("i");
    folderIcon.className = "codicon codicon-folder";
    meta.appendChild(folderIcon);
    const noGit = document.createElement("span");
    noGit.textContent = "no git";
    meta.appendChild(noGit);
  }
  row.appendChild(meta);

  const closeBtn = document.createElement("span");
  closeBtn.className = "ws-close";
  closeBtn.setAttribute("role", "button");
  closeBtn.setAttribute("aria-label", `Close ${workspace.label}`);
  closeBtn.tabIndex = -1;
  const closeIcon = document.createElement("i");
  closeIcon.className = "codicon codicon-close";
  closeBtn.appendChild(closeIcon);
  row.appendChild(closeBtn);

  row.addEventListener("click", (event) => {
    if (closeBtn.contains(event.target as Node)) return;
    callbacks.onFocusWorkspace(workspace.workspace_id);
    // Finding #3: a sidebar row click, like a tab click, returns keyboard
    // focus to the terminal capture instead of leaving it on the row.
    focusKeyboardCapture();
  });

  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openWorkspaceCloseConfirm(workspace, all, overlayRoot, row, callbacks);
  });

  const openContextMenu = (x: number, y: number) => {
    const rootRect = overlayRoot.getBoundingClientRect();
    const items: MenuItemSpec[] = [
      {
        id: "rename",
        label: "Rename…",
        // Finding #14: inline editing in the row, reusing the tab
        // inline-rename component -- never `window.prompt`.
        onSelect: () =>
          startInlineRename(
            name,
            { id: workspace.workspace_id, label: workspace.label },
            { onRename: callbacks.onRenameWorkspace },
            SIDEBAR_RENDER_GUARD_REGION,
          ),
      },
      {
        id: "change-color",
        label: "Change Color",
        swatchSubmenu: {
          colors: Array.from({ length: 10 }, (_, i) => resolveWorkspacePaletteColor(i, theme)),
          currentIndex: colorIndex ?? -1,
          onPick: (index) => callbacks.onChangeColor(workspace.workspace_id, index),
        },
      },
    ];
    openMenu(overlayRoot, { left: x - rootRect.left, top: y - rootRect.top }, items, {
      returnFocusTo: keyboardCaptureReturnTarget(),
    });
  };

  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "F10" && event.shiftKey) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      openContextMenu(rect.left, rect.bottom);
    } else if (event.key === "Enter") {
      // Keyboard shortcuts feature (Ctrl+Shift+E "focus sidebar"): Enter
      // on a row focuses that workspace, then returns keyboard focus to
      // the terminal capture -- the row keeps only a roving `tabindex`,
      // not lasting keyboard focus, once its job is done.
      callbacks.onFocusWorkspace(workspace.workspace_id);
      focusKeyboardCapture();
    } else if (event.key === "Escape") {
      // Esc backs out of sidebar keyboard navigation with no change.
      event.preventDefault();
      focusKeyboardCapture();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSidebarRovingFocus(row, event.key === "ArrowDown" ? 1 : -1);
    }
  });

  return row;
}

/** Roving `tabindex` between sidebar rows (Ctrl+Shift+E's ArrowUp/Down):
 * only one row is ever `tabindex="0"` at a time. Reads siblings from the
 * DOM at the moment of the keypress rather than a captured array, since
 * `row` is the one durable reference each row's own keydown closure has. */
function moveSidebarRovingFocus(row: HTMLElement, direction: 1 | -1): void {
  const rows = Array.from(row.parentElement?.children ?? []) as HTMLElement[];
  const currentIndex = rows.indexOf(row);
  if (currentIndex === -1 || rows.length === 0) return;
  const nextIndex = ((currentIndex + direction) % rows.length + rows.length) % rows.length;
  const next = rows[nextIndex];
  row.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}

/** Ctrl+Shift+E ("focus sidebar", keyboard shortcuts feature): moves
 * keyboard focus onto the selected workspace's row, or the first row when
 * none is selected. A no-op with an empty sidebar. Sets up the roving
 * `tabindex` (only the focused row keeps `0`) that
 * `moveSidebarRovingFocus` then maintains on ArrowUp/Down. */
export function focusSidebarRow(listEl: HTMLElement): void {
  const rows = Array.from(listEl.querySelectorAll<HTMLElement>(".ws"));
  if (rows.length === 0) return;
  const target = rows.find((row) => row.classList.contains("is-selected")) ?? rows[0];
  for (const row of rows) row.tabIndex = row === target ? 0 : -1;
  target.focus();
}

function openWorkspaceCloseConfirm(
  workspace: SidebarWorkspace,
  all: readonly SidebarWorkspace[],
  overlayRoot: HTMLElement,
  rowEl: HTMLElement,
  callbacks: SidebarCallbacks,
): void {
  // Populated by the caller via `renderSidebar`'s closure below (agent
  // counts need the full snapshot, not just this row's workspace).
  const detail = (rowEl.dataset.closeDetail as string) || "No agents running";
  openConfirmPopover(overlayRoot, rowEl, {
    titlePrefix: "Close ",
    titleName: workspace.label,
    titleSuffix: "?",
    detail,
    confirmLabel: "Close",
    onConfirm: () => {
      void handleCloseConfirmed(workspace, callbacks, overlayRoot, rowEl, all);
    },
  });
}

export function closeDetailText(counts: WorkspaceAgentCounts): string {
  if (counts.working === 0 && counts.blocked === 0) return "No agents running";
  const parts: string[] = [];
  if (counts.working > 0) parts.push(`${counts.working} agents running`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked will be stopped`);
  return parts.join(" · ");
}

/** Keyboard shortcuts feature, item 6: `"<label> (Ctrl+Shift+N)"` for a row
 * at `index` (0-based, sidebar order) among `total` rows -- N for index <
 * `DIRECT_FOCUS_SLOT_COUNT` (1-8), and the last row (whatever its index)
 * also always mentions Ctrl+Shift+9. Plain `label` when neither applies. */
export function sidebarRowTooltip(label: string, index: number, total: number): string {
  const hints: string[] = [];
  if (index < DIRECT_FOCUS_SLOT_COUNT) hints.push(`Ctrl+Shift+${index + 1}`);
  if (index === total - 1) hints.push(`Ctrl+Shift+${LAST_FOCUS_SHORTCUT_DIGIT}`);
  return hints.length > 0 ? `${label} (${hints.join(" / ")})` : label;
}

export function renderSidebar(
  listEl: HTMLElement,
  overlayRoot: HTMLElement,
  workspaces: readonly SidebarWorkspace[],
  agentCounts: ReadonlyMap<string, WorkspaceAgentCounts>,
  colorAssignment: Readonly<Record<string, number>>,
  theme: ThemeColors,
  callbacks: SidebarCallbacks,
): void {
  listEl.textContent = "";
  workspaces.forEach((workspace, index) => {
    const row = renderRow(workspace, workspaces, overlayRoot, colorAssignment[workspace.workspace_id], theme, callbacks);
    row.title = sidebarRowTooltip(workspace.label, index, workspaces.length);
    row.dataset.closeDetail = closeDetailText(agentCountsFor(workspace.workspace_id, agentCounts));
    listEl.appendChild(row);
  });
}
