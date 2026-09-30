// Sidebar: workspace rows (spec phase1.5 §5 "Sidebar", §6a "Workspace
// colours"). No nested tabs, no agents section, no collapsible groups --
// one flat row per workspace.

import { focusKeyboardCapture, keyboardCaptureReturnTarget } from "../keyboard/focusCapture";
import { DIRECT_FOCUS_SLOT_COUNT } from "../shortcuts";
import { resolveWorkspacePaletteColor, type ThemeColors } from "../themes/tokens";
import { LAST_FOCUS_SHORTCUT_DIGIT } from "../workspace/focusByIndex";
import { openConfirmPopover, type ConfirmPopoverAgentList } from "./confirmPopover";
import type { MenuItemSpec } from "./menu";
import { openMenu } from "./menu";
import { createStatusDotOrSlot } from "./statusDot";
import { startInlineRename } from "./tabs";

/** Finding #5/#14: the render-guard region a workspace inline rename
 * claims, reusing `tabs.ts`'s `startInlineRename` component but under its
 * own region -- a sidebar rename must not block the tab strip's
 * re-render, and vice versa. `main.ts` imports `isRenderGuarded` directly
 * from `./renderGuard` and uses this region name with it. */
export const SIDEBAR_RENDER_GUARD_REGION = "sidebar";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** UX pass 1 spec §3 "Sidebar line 2 for attention states only": a blocked
 * agent anywhere in the workspace outranks a done one, which outranks the
 * ordinary branch line. `ageLabel` is `""` when the age isn't known yet
 * (spec §2 "unknown age shows nothing, not '0m'") -- rendered as the bare
 * status word with no trailing age. */
export type SidebarAttention =
  | { kind: "blocked"; ageLabel: string }
  | { kind: "done"; ageLabel: string }
  | { kind: "branch" };

/** Finding #7: "done · age" shows *only* when the workspace has done agents
 * and no blocked and no working agents (spec's literal "only done
 * agents") -- a workspace with a done agent alongside a still-working one
 * shows the branch instead, not "done". A blocked agent still always wins
 * regardless of `hasWorking`. */
export function sidebarAttention(
  hasBlocked: boolean,
  blockedAgeLabel: string,
  hasDone: boolean,
  doneAgeLabel: string,
  hasWorking: boolean = false,
): SidebarAttention {
  if (hasBlocked) return { kind: "blocked", ageLabel: blockedAgeLabel };
  if (hasDone && !hasWorking) return { kind: "done", ageLabel: doneAgeLabel };
  return { kind: "branch" };
}

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
  /** Optional so existing callers/fixtures that don't compute it keep
   * today's plain branch line (spec §3's default: "Otherwise it shows the
   * branch as today"). */
  attention?: SidebarAttention;
}

export interface WorkspaceAgentCounts {
  working: number;
  blocked: number;
}

/** One agent in a workspace, for the close-confirm's "Name what stops"
 * list (UX pass 1 spec §1) and for `closeDetailText`'s counts. Only
 * "working" or "blocked" agents belong in this list. */
export interface WorkspaceAgentLine {
  status: AgentStatus;
  tabLabel: string;
  agentName: string;
}

const CLOSE_CONFIRM_AGENT_LINE_LIMIT = 5;

/** Truncates the close-confirm's "Name what stops" list to at most 5 lines
 * (spec §1), reporting how many more agents exist beyond that. */
export function closeConfirmAgentLines(agents: readonly WorkspaceAgentLine[]): ConfirmPopoverAgentList {
  return {
    lines: agents.slice(0, CLOSE_CONFIRM_AGENT_LINE_LIMIT),
    overflow: Math.max(0, agents.length - CLOSE_CONFIRM_AGENT_LINE_LIMIT),
  };
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

function agentLinesFor(
  workspaceId: string,
  lines: ReadonlyMap<string, readonly WorkspaceAgentLine[]>,
): readonly WorkspaceAgentLine[] {
  return lines.get(workspaceId) ?? [];
}

function countsFromAgentLines(agents: readonly WorkspaceAgentLine[]): WorkspaceAgentCounts {
  return {
    working: agents.filter((a) => a.status === "working").length,
    blocked: agents.filter((a) => a.status === "blocked").length,
  };
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
  agentLines: readonly WorkspaceAgentLine[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "ws";
  row.setAttribute("role", "option");
  row.tabIndex = 0;
  row.dataset.workspaceId = workspace.workspace_id;
  if (workspace.focused) row.classList.add("is-selected");
  if (workspace.agent_status === "blocked") row.classList.add("is-blocked");
  row.setAttribute("aria-selected", String(workspace.focused));

  row.appendChild(createStatusDotOrSlot(workspace.agent_status));

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
  const attention = workspace.attention ?? { kind: "branch" as const };
  if (attention.kind !== "branch") {
    // UX pass 1 spec §3: line 2 shows the attention state instead of the
    // branch while any agent needs it; the branch stays available as the
    // row's tooltip (below) regardless.
    meta.classList.add(`ws-meta--${attention.kind}`);
    const text = document.createElement("span");
    text.textContent = attention.ageLabel ? `${attention.kind} · ${attention.ageLabel}` : attention.kind;
    meta.appendChild(text);
  } else if (workspace.branch) {
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
    openWorkspaceCloseConfirm(workspace, all, overlayRoot, row, callbacks, agentLines);
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
  agentLines: readonly WorkspaceAgentLine[],
): void {
  openConfirmPopover(overlayRoot, rowEl, {
    titlePrefix: "Close ",
    titleName: workspace.label,
    titleSuffix: "?",
    detail: closeDetailText(countsFromAgentLines(agentLines)),
    // UX pass 1 spec §1 "Name what stops".
    agentLines: closeConfirmAgentLines(agentLines),
    confirmLabel: "Close",
    onConfirm: () => {
      void handleCloseConfirmed(workspace, callbacks, overlayRoot, rowEl, all);
    },
  });
}

function pluralAgents(n: number): string {
  return n === 1 ? "agent" : "agents";
}

/** UX pass 1 spec §1 "[P0]": handles the plural correctly and says what
 * the destructive action actually does, e.g. "Stops 2 working and 1
 * blocked agent." (both categories share one trailing noun, pluralised by
 * whichever count is named last) or "Stops 3 blocked agents." (a single
 * category). "No agents running." with neither. */
export function closeDetailText(counts: WorkspaceAgentCounts): string {
  const { working, blocked } = counts;
  if (working === 0 && blocked === 0) return "No agents running.";
  if (working > 0 && blocked > 0) {
    return `Stops ${working} working and ${blocked} blocked ${pluralAgents(blocked)}.`;
  }
  if (working > 0) return `Stops ${working} working ${pluralAgents(working)}.`;
  return `Stops ${blocked} blocked ${pluralAgents(blocked)}.`;
}

/** Keyboard shortcuts feature, item 6: `"<label> (Ctrl+Shift+N)"` for a row
 * at `index` (0-based, sidebar order) among `total` rows -- N for index <
 * `DIRECT_FOCUS_SLOT_COUNT` (1-8), and the last row (whatever its index)
 * also always mentions Ctrl+Shift+9. Plain `label` when neither applies.
 * `branch`, when given, is always appended (UX pass 1 spec §3: "The branch
 * is always available as the row tooltip"), even when line 2 is currently
 * showing an attention state instead of the branch. */
export function sidebarRowTooltip(label: string, index: number, total: number, branch: string | null = null): string {
  const hints: string[] = [];
  if (index < DIRECT_FOCUS_SLOT_COUNT) hints.push(`Ctrl+Shift+${index + 1}`);
  if (index === total - 1) hints.push(`Ctrl+Shift+${LAST_FOCUS_SHORTCUT_DIGIT}`);
  const base = hints.length > 0 ? `${label} (${hints.join(" / ")})` : label;
  return branch ? `${base} — ${branch}` : base;
}

export function renderSidebar(
  listEl: HTMLElement,
  overlayRoot: HTMLElement,
  workspaces: readonly SidebarWorkspace[],
  agentLines: ReadonlyMap<string, readonly WorkspaceAgentLine[]>,
  colorAssignment: Readonly<Record<string, number>>,
  theme: ThemeColors,
  callbacks: SidebarCallbacks,
): void {
  listEl.textContent = "";
  workspaces.forEach((workspace, index) => {
    const lines = agentLinesFor(workspace.workspace_id, agentLines);
    const row = renderRow(workspace, workspaces, overlayRoot, colorAssignment[workspace.workspace_id], theme, callbacks, lines);
    row.title = sidebarRowTooltip(workspace.label, index, workspaces.length, workspace.branch);
    listEl.appendChild(row);
  });
}
