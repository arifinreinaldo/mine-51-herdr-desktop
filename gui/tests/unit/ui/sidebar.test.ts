// @vitest-environment jsdom
//
// Finding #14 "workspace rename → inline editing in the sidebar row
// (reuse the tab inline-rename component ...) -- remove window.prompt
// entirely." These exercise the real DOM flow: open the row's context
// menu, select Rename…, and confirm an `<input>` replaces the label (no
// `window.prompt` call), Enter commits `onRenameWorkspace`, and Esc
// cancels -- plus finding #5's render guard for this same input.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerKeyboardCapture } from "../../../src/keyboard/focusCapture";
import { isRenderGuarded } from "../../../src/ui/renderGuard";
import {
  closeConfirmAgentLines,
  closeDetailText,
  focusSidebarRow,
  renderSidebar,
  sidebarAttention,
  sidebarRowTooltip,
  SIDEBAR_RENDER_GUARD_REGION,
  type SidebarCallbacks,
  type SidebarWorkspace,
  type WorkspaceAgentLine,
} from "../../../src/ui/sidebar";
import { DARK_MODERN_COLORS } from "../../../src/themes/dark-modern";

let listEl: HTMLDivElement;
let overlayRoot: HTMLDivElement;

function makeCallbacks(overrides: Partial<SidebarCallbacks> = {}): SidebarCallbacks {
  return {
    onFocusWorkspace: vi.fn(),
    onCloseWorkspace: vi.fn().mockResolvedValue({ groupCloseRequired: false }),
    onRenameWorkspace: vi.fn(),
    onChangeColor: vi.fn(),
    ...overrides,
  };
}

function workspaces(): SidebarWorkspace[] {
  return [
    { workspace_id: "w1", label: "one", focused: true, agent_status: "idle", branch: null, git_ahead_behind: null, worktree_key: null },
  ];
}

function render(callbacks: SidebarCallbacks): void {
  renderSidebar(listEl, overlayRoot, workspaces(), new Map(), {}, DARK_MODERN_COLORS, callbacks);
}

beforeEach(() => {
  listEl = document.createElement("div");
  overlayRoot = document.createElement("div");
  document.body.append(listEl, overlayRoot);
});

afterEach(() => {
  document
    .querySelectorAll<HTMLElement>(".tab-rename-input")
    .forEach((input) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  listEl.remove();
  overlayRoot.remove();
});

describe("sidebar inline workspace rename (finding #14)", () => {
  it("opening Rename… from the row's context menu replaces the label with an input, never window.prompt", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const callbacks = makeCallbacks();
    render(callbacks);
    const row = listEl.querySelector<HTMLElement>('[data-workspace-id="w1"]')!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    const renameItem = overlayRoot.querySelector<HTMLElement>('[data-item-id="rename"]')!;
    renameItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(promptSpy).not.toHaveBeenCalled();
    const input = listEl.querySelector<HTMLInputElement>(".tab-rename-input");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("one");
    expect(isRenderGuarded(SIDEBAR_RENDER_GUARD_REGION)).toBe(true);
    promptSpy.mockRestore();
  });

  it("Enter commits the new label via onRenameWorkspace(id, label) and releases the guard", () => {
    const callbacks = makeCallbacks();
    render(callbacks);
    const row = listEl.querySelector<HTMLElement>('[data-workspace-id="w1"]')!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    overlayRoot.querySelector<HTMLElement>('[data-item-id="rename"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = listEl.querySelector<HTMLInputElement>(".tab-rename-input")!;
    input.value = "renamed workspace";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(callbacks.onRenameWorkspace).toHaveBeenCalledWith("w1", "renamed workspace");
    expect(isRenderGuarded(SIDEBAR_RENDER_GUARD_REGION)).toBe(false);
    expect(listEl.querySelector(".tab-rename-input")).toBeNull();
  });

  it("Esc cancels without committing", () => {
    const callbacks = makeCallbacks();
    render(callbacks);
    const row = listEl.querySelector<HTMLElement>('[data-workspace-id="w1"]')!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    overlayRoot.querySelector<HTMLElement>('[data-item-id="rename"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = listEl.querySelector<HTMLInputElement>(".tab-rename-input")!;
    input.value = "should not be committed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(callbacks.onRenameWorkspace).not.toHaveBeenCalled();
    expect(listEl.querySelector(".ws-name")?.textContent).toBe("one");
  });
});

// Keyboard shortcuts feature: Ctrl+Shift+E ("focus sidebar") moves keyboard
// focus into the sidebar row list; ArrowUp/Down then rove `tabindex`
// between rows, Enter focuses the workspace and returns focus to the
// terminal capture, and Esc returns focus with no change.

function manyWorkspaces(focusedId: string | null = null): SidebarWorkspace[] {
  return ["w1", "w2", "w3"].map((id, i) => ({
    workspace_id: id,
    label: `ws-${i + 1}`,
    focused: id === focusedId,
    agent_status: "idle",
    branch: null,
    git_ahead_behind: null,
    worktree_key: null,
  }));
}

function renderMany(callbacks: SidebarCallbacks, focusedId: string | null = null): void {
  renderSidebar(listEl, overlayRoot, manyWorkspaces(focusedId), new Map(), {}, DARK_MODERN_COLORS, callbacks);
}

describe("sidebar keyboard navigation (Ctrl+Shift+E)", () => {
  let captureEl: HTMLTextAreaElement;

  beforeEach(() => {
    captureEl = document.createElement("textarea");
    document.body.appendChild(captureEl);
    registerKeyboardCapture(captureEl);
  });

  afterEach(() => {
    captureEl.remove();
  });

  it("focusSidebarRow focuses the selected row when one is selected", () => {
    const callbacks = makeCallbacks();
    renderMany(callbacks, "w2");
    focusSidebarRow(listEl);
    const row = listEl.querySelector<HTMLElement>('[data-workspace-id="w2"]')!;
    expect(document.activeElement).toBe(row);
    expect(row.tabIndex).toBe(0);
    expect(listEl.querySelector<HTMLElement>('[data-workspace-id="w1"]')!.tabIndex).toBe(-1);
  });

  it("focusSidebarRow falls back to the first row when none is selected", () => {
    const callbacks = makeCallbacks();
    renderMany(callbacks, null);
    focusSidebarRow(listEl);
    expect(document.activeElement).toBe(listEl.querySelector('[data-workspace-id="w1"]'));
  });

  it("focusSidebarRow on an empty sidebar is a no-op", () => {
    expect(listEl.querySelectorAll(".ws")).toHaveLength(0);
    expect(() => focusSidebarRow(listEl)).not.toThrow();
  });

  it("ArrowDown/ArrowUp rove tabindex + focus between rows, wrapping at the ends", () => {
    const callbacks = makeCallbacks();
    renderMany(callbacks, "w1");
    focusSidebarRow(listEl);
    const [row1, row2, row3] = ["w1", "w2", "w3"].map(
      (id) => listEl.querySelector<HTMLElement>(`[data-workspace-id="${id}"]`)!,
    );

    row1.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(row2);
    expect(row1.tabIndex).toBe(-1);
    expect(row2.tabIndex).toBe(0);

    row2.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(row1);

    // Wraps: ArrowUp from the first row goes to the last.
    row1.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(row3);

    // Wraps: ArrowDown from the last row goes back to the first.
    row3.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(row1);
  });

  it("Enter focuses the workspace, then returns focus to the terminal capture", () => {
    const callbacks = makeCallbacks();
    renderMany(callbacks, "w1");
    focusSidebarRow(listEl);
    const row2 = listEl.querySelector<HTMLElement>('[data-workspace-id="w2"]')!;
    row2.tabIndex = 0;
    row2.focus();

    row2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(callbacks.onFocusWorkspace).toHaveBeenCalledWith("w2");
    expect(document.activeElement).toBe(captureEl);
  });

  it("Esc returns focus to the terminal capture without focusing any workspace", () => {
    const callbacks = makeCallbacks();
    renderMany(callbacks, "w1");
    focusSidebarRow(listEl);
    const row1 = listEl.querySelector<HTMLElement>('[data-workspace-id="w1"]')!;

    row1.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(callbacks.onFocusWorkspace).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(captureEl);
  });
});

describe("sidebarRowTooltip (keyboard shortcuts feature, item 6)", () => {
  it("positions 1-8 get their own Ctrl+Shift+N hint", () => {
    expect(sidebarRowTooltip("one", 0, 10)).toBe("one (Ctrl+Shift+1)");
    expect(sidebarRowTooltip("eight", 7, 10)).toBe("eight (Ctrl+Shift+8)");
  });

  it("the last row always also mentions Ctrl+Shift+9, even within positions 1-8", () => {
    expect(sidebarRowTooltip("last-of-five", 4, 5)).toBe("last-of-five (Ctrl+Shift+5 / Ctrl+Shift+9)");
  });

  it("the last row beyond position 8 mentions only Ctrl+Shift+9", () => {
    expect(sidebarRowTooltip("last-of-twelve", 11, 12)).toBe("last-of-twelve (Ctrl+Shift+9)");
  });

  it("a row beyond position 8 that is not last gets the plain label", () => {
    expect(sidebarRowTooltip("ninth", 8, 12)).toBe("ninth");
  });

  it("renderSidebar wires the title attribute for every row", () => {
    const callbacks = makeCallbacks();
    renderMany(callbacks, "w1");
    expect(listEl.querySelector('[data-workspace-id="w1"]')?.getAttribute("title")).toBe(
      "ws-1 (Ctrl+Shift+1)",
    );
    expect(listEl.querySelector('[data-workspace-id="w3"]')?.getAttribute("title")).toBe(
      "ws-3 (Ctrl+Shift+3 / Ctrl+Shift+9)",
    );
  });

  it("appends the branch to the tooltip when given, even with no shortcut hint", () => {
    expect(sidebarRowTooltip("ninth", 8, 12, "main")).toBe("ninth — main");
  });

  it("omits the branch suffix when there is none", () => {
    expect(sidebarRowTooltip("one", 0, 10, null)).toBe("one (Ctrl+Shift+1)");
  });
});

// UX pass 1 spec §1 "[P0] Safe close-workspace confirm": "Fix the count
// text ... Handle the plural correctly."
describe("closeDetailText (UX pass 1 spec §1)", () => {
  it("says nothing is running with no agents", () => {
    expect(closeDetailText({ working: 0, blocked: 0 })).toBe("No agents running.");
  });

  it("singular/plural for a single category", () => {
    expect(closeDetailText({ working: 1, blocked: 0 })).toBe("Stops 1 working agent.");
    expect(closeDetailText({ working: 2, blocked: 0 })).toBe("Stops 2 working agents.");
    expect(closeDetailText({ working: 0, blocked: 1 })).toBe("Stops 1 blocked agent.");
    expect(closeDetailText({ working: 0, blocked: 3 })).toBe("Stops 3 blocked agents.");
  });

  it("both categories share one trailing noun -- the literal spec example", () => {
    expect(closeDetailText({ working: 2, blocked: 1 })).toBe("Stops 2 working and 1 blocked agent.");
  });

  it("both categories, trailing noun pluralised by the blocked count", () => {
    expect(closeDetailText({ working: 1, blocked: 2 })).toBe("Stops 1 working and 2 blocked agents.");
  });
});

// UX pass 1 spec §1 "Name what stops": "at most 5 lines, then 'and N more'."
describe("closeConfirmAgentLines (UX pass 1 spec §1)", () => {
  function agents(n: number): WorkspaceAgentLine[] {
    return Array.from({ length: n }, (_, i) => ({
      status: "working" as const,
      tabLabel: `tab-${i}`,
      agentName: "claude",
    }));
  }

  it("passes through unchanged with 5 or fewer agents, no overflow", () => {
    const result = closeConfirmAgentLines(agents(3));
    expect(result.lines).toHaveLength(3);
    expect(result.overflow).toBe(0);
  });

  it("exactly 5 agents: no overflow", () => {
    expect(closeConfirmAgentLines(agents(5)).overflow).toBe(0);
  });

  it("truncates to 5 lines and reports the overflow count", () => {
    const result = closeConfirmAgentLines(agents(8));
    expect(result.lines).toHaveLength(5);
    expect(result.overflow).toBe(3);
  });
});

// UX pass 1 spec §3 "Sidebar line 2 for attention states only".
describe("sidebarAttention (UX pass 1 spec §3)", () => {
  it("blocked outranks done and the branch", () => {
    expect(sidebarAttention(true, "12m", true, "3m")).toEqual({ kind: "blocked", ageLabel: "12m" });
  });

  it("done shows when there's no blocked agent and no working agent", () => {
    expect(sidebarAttention(false, "", true, "3m")).toEqual({ kind: "done", ageLabel: "3m" });
    expect(sidebarAttention(false, "", true, "3m", false)).toEqual({ kind: "done", ageLabel: "3m" });
  });

  it("falls back to the branch with neither", () => {
    expect(sidebarAttention(false, "", false, "")).toEqual({ kind: "branch" });
  });

  it("an unknown age renders as the bare status word (empty ageLabel), not '0m'", () => {
    expect(sidebarAttention(true, "", false, "")).toEqual({ kind: "blocked", ageLabel: "" });
  });

  // Finding #7: "done · age" shows only when the workspace has done agents
  // and NO blocked and NO working agents (spec's literal "only done
  // agents") -- a done agent alongside a still-working one falls back to
  // the branch instead, since the workspace isn't purely done yet.
  it("falls back to the branch when there's a done agent alongside a working one", () => {
    expect(sidebarAttention(false, "", true, "3m", true)).toEqual({ kind: "branch" });
  });

  it("blocked still wins even alongside both a done and a working agent", () => {
    expect(sidebarAttention(true, "12m", true, "3m", true)).toEqual({ kind: "blocked", ageLabel: "12m" });
  });
});

// UX pass 1 spec §3: the sidebar row's line 2 shows the attention state
// instead of the branch, with the branch still available as the tooltip.
describe("sidebar row line 2 (UX pass 1 spec §3)", () => {
  function workspaceWithAttention(attention: SidebarWorkspace["attention"]): SidebarWorkspace[] {
    return [
      {
        workspace_id: "w1",
        label: "one",
        focused: false,
        agent_status: "blocked",
        branch: "main",
        git_ahead_behind: null,
        worktree_key: null,
        attention,
      },
    ];
  }

  it("shows 'blocked · <age>' and the ws-meta--blocked class", () => {
    renderSidebar(listEl, overlayRoot, workspaceWithAttention({ kind: "blocked", ageLabel: "12m" }), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    const meta = listEl.querySelector(".ws-meta")!;
    expect(meta.textContent).toBe("blocked · 12m");
    expect(meta.classList.contains("ws-meta--blocked")).toBe(true);
  });

  it("shows the bare status word when the age is unknown", () => {
    renderSidebar(listEl, overlayRoot, workspaceWithAttention({ kind: "blocked", ageLabel: "" }), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    expect(listEl.querySelector(".ws-meta")?.textContent).toBe("blocked");
  });

  it("shows 'done · <age>' with the ws-meta--done class", () => {
    renderSidebar(listEl, overlayRoot, workspaceWithAttention({ kind: "done", ageLabel: "5m" }), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    const meta = listEl.querySelector(".ws-meta")!;
    expect(meta.textContent).toBe("done · 5m");
    expect(meta.classList.contains("ws-meta--done")).toBe(true);
  });

  it("falls back to the branch when attention is 'branch' (or omitted)", () => {
    renderSidebar(listEl, overlayRoot, workspaceWithAttention({ kind: "branch" }), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    expect(listEl.querySelector(".ws-meta")?.textContent).toBe("main");
    renderSidebar(listEl, overlayRoot, workspaceWithAttention(undefined), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    expect(listEl.querySelector(".ws-meta")?.textContent).toBe("main");
  });

  it("the branch is always the row tooltip, even while line 2 shows an attention state", () => {
    renderSidebar(listEl, overlayRoot, workspaceWithAttention({ kind: "blocked", ageLabel: "12m" }), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    expect(listEl.querySelector(".ws")?.getAttribute("title")).toContain("main");
  });
});

// UX pass 1 spec §1 "Name what stops": the close-workspace confirm lists
// which agents actually stop.
describe("close-workspace confirm agent list (UX pass 1 spec §1)", () => {
  function workspaceRow(): SidebarWorkspace[] {
    return [
      {
        workspace_id: "w1",
        label: "one",
        focused: false,
        agent_status: "blocked",
        branch: "main",
        git_ahead_behind: null,
        worktree_key: null,
      },
    ];
  }

  it("lists the workspace's working/blocked agents and the summary line", () => {
    const lines = new Map<string, WorkspaceAgentLine[]>([
      [
        "w1",
        [
          { status: "blocked", tabLabel: "review", agentName: "claude" },
          { status: "working", tabLabel: "build", agentName: "codex" },
        ],
      ],
    ]);
    renderSidebar(listEl, overlayRoot, workspaceRow(), lines, {}, DARK_MODERN_COLORS, makeCallbacks());
    listEl.querySelector<HTMLElement>(".ws-close")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(overlayRoot.querySelector(".confirm-popover__detail")?.textContent).toBe(
      "Stops 1 working and 1 blocked agent.",
    );
    const agentLines = overlayRoot.querySelectorAll(".confirm-popover__agent-line");
    expect(agentLines).toHaveLength(2);
    expect(agentLines[0].textContent).toContain("review · claude");
    expect(agentLines[1].textContent).toContain("build · codex");
  });

  it("says 'No agents running.' and shows no agent-list section with none", () => {
    renderSidebar(listEl, overlayRoot, workspaceRow(), new Map(), {}, DARK_MODERN_COLORS, makeCallbacks());
    listEl.querySelector<HTMLElement>(".ws-close")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(overlayRoot.querySelector(".confirm-popover__detail")?.textContent).toBe("No agents running.");
    expect(overlayRoot.querySelector(".confirm-popover__agent-list")).toBeNull();
  });
});
