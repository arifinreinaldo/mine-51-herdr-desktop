// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { openPaneContextMenu, type PaneContextMenuCallbacks } from "../../../src/ui/paneContextMenu";

function fakeCallbacks(overrides: Partial<PaneContextMenuCallbacks> = {}): PaneContextMenuCallbacks {
  const noop = () => {};
  return {
    hasSelection: false,
    rightClickPassthrough: false,
    onCopy: noop,
    onPaste: noop,
    onSelectAll: noop,
    onClear: noop,
    onSplitRight: noop,
    onSplitDown: noop,
    onToggleZoom: noop,
    onTogglePassthrough: noop,
    onClosePane: noop,
    ...overrides,
  };
}

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

function itemLabels(): string[] {
  return Array.from(root.querySelectorAll(".menu-item span:not(.menu-item__key)")).map((el) => el.textContent ?? "");
}

describe("openPaneContextMenu", () => {
  it("omits Copy when there is no selection", () => {
    openPaneContextMenu(root, { left: 0, top: 0 }, fakeCallbacks({ hasSelection: false }));
    expect(itemLabels()).not.toContain("Copy");
  });

  it("includes Copy first when there is a selection", () => {
    openPaneContextMenu(root, { left: 0, top: 0 }, fakeCallbacks({ hasSelection: true }));
    expect(itemLabels()[0]).toBe("Copy");
  });

  it("always includes Paste, Select All, Clear, Split Right/Down, Toggle Zoom, the passthrough toggle, and Close Pane", () => {
    openPaneContextMenu(root, { left: 0, top: 0 }, fakeCallbacks());
    const labels = itemLabels();
    for (const expected of [
      "Paste",
      "Select All",
      "Clear",
      "Split Right",
      "Split Down",
      "Toggle Zoom",
      "Send Right-Clicks to Pane",
      "Close Pane",
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it("invokes the matching callback on click", () => {
    let cleared = false;
    openPaneContextMenu(root, { left: 0, top: 0 }, fakeCallbacks({ onClear: () => (cleared = true) }));
    const clearItem = Array.from(root.querySelectorAll<HTMLElement>(".menu-item")).find((el) =>
      el.textContent?.includes("Clear"),
    );
    clearItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cleared).toBe(true);
  });

  it("shows the passthrough toggle as checked when right_click_passthrough is on", () => {
    openPaneContextMenu(root, { left: 0, top: 0 }, fakeCallbacks({ rightClickPassthrough: true }));
    const checkmarks = root.querySelectorAll(".menu-checkmark");
    expect(checkmarks.length).toBe(1);
  });
});
