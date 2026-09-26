// @vitest-environment jsdom
//
// Finding #14 "workspace rename → inline editing in the sidebar row
// (reuse the tab inline-rename component ...) -- remove window.prompt
// entirely." These exercise the real DOM flow: open the row's context
// menu, select Rename…, and confirm an `<input>` replaces the label (no
// `window.prompt` call), Enter commits `onRenameWorkspace`, and Esc
// cancels -- plus finding #5's render guard for this same input.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRenderGuarded } from "../../../src/ui/renderGuard";
import {
  renderSidebar,
  SIDEBAR_RENDER_GUARD_REGION,
  type SidebarCallbacks,
  type SidebarWorkspace,
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
