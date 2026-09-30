// @vitest-environment jsdom
//
// The "Keyboard Shortcuts" modal (Ctrl+Shift+/, herdr ▸ Keyboard Shortcuts,
// Help ▸ Keyboard Shortcuts): searchable, grouped by menu, and rendered
// entirely from `shortcuts.ts`'s cheat-sheet data (single source of truth).

import { beforeEach, describe, expect, it } from "vitest";
import { registerKeyboardCapture } from "../../../src/keyboard/focusCapture";
import { cheatSheetEntries } from "../../../src/shortcuts";
import { openKeyboardShortcutsModal } from "../../../src/ui/shortcutsModal";

let captureEl: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  captureEl = document.createElement("textarea");
  document.body.appendChild(captureEl);
  registerKeyboardCapture(captureEl);
});

describe("openKeyboardShortcutsModal", () => {
  it("renders exactly the cheat-sheet entries, grouped under their menu headings", () => {
    openKeyboardShortcutsModal();
    const rows = document.querySelectorAll(".modal-shortcut-row");
    expect(rows).toHaveLength(cheatSheetEntries().length);
    const headings = Array.from(document.querySelectorAll(".shortcuts-modal-group")).map((h) => h.textContent);
    expect(headings).toEqual(["Workspace", "Tab", "Pane", "Agents", "View", "Cowbell"]);
  });

  it("the Alt+1..9 / Ctrl+Shift+1..9 ranges each show as a single row, not nine", () => {
    openKeyboardShortcutsModal();
    const rows = Array.from(document.querySelectorAll(".modal-shortcut-row"));
    const tabRangeRows = rows.filter((r) => r.querySelector(".key")?.textContent === "Alt+1 … Alt+9");
    expect(tabRangeRows).toHaveLength(1);
  });

  it("typing in the search box filters the list live, by label text", () => {
    openKeyboardShortcutsModal();
    const search = document.querySelector<HTMLInputElement>(".shortcuts-modal-search")!;
    search.value = "split right";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const rows = document.querySelectorAll(".modal-shortcut-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Split Right");
  });

  it("also filters by key/display text", () => {
    openKeyboardShortcutsModal();
    const search = document.querySelector<HTMLInputElement>(".shortcuts-modal-search")!;
    search.value = "ctrl+shift+w";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const rows = document.querySelectorAll(".modal-shortcut-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Close Tab");
  });

  it("a query matching nothing shows the empty state, not a blank list", () => {
    openKeyboardShortcutsModal();
    const search = document.querySelector<HTMLInputElement>(".shortcuts-modal-search")!;
    search.value = "xyzzy no such shortcut";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelectorAll(".modal-shortcut-row")).toHaveLength(0);
    expect(document.querySelector(".shortcuts-modal-empty")).not.toBeNull();
  });

  it("Esc closes the modal and returns focus to the terminal capture", () => {
    openKeyboardShortcutsModal();
    expect(document.querySelector(".modal-backdrop")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(document.activeElement).toBe(captureEl);
  });
});
