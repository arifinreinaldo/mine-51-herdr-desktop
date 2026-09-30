import { describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "../../../src/shortcuts";
import { closeItems, paneLayoutItems } from "../../../src/ui/paneActionItems";

const display = (id: string) => SHORTCUTS.find((s) => s.id === id)?.display;

function layout() {
  return paneLayoutItems({ onSplitRight: vi.fn(), onSplitDown: vi.fn(), onToggleZoom: vi.fn() });
}

describe("paneLayoutItems", () => {
  it("lists Split Right, Split Down and Toggle Zoom with icons and shortcuts", () => {
    const items = layout();
    expect(items.map((i) => [i.id, i.label, i.icon])).toEqual([
      ["pane.splitRight", "Split Right", "split-horizontal"],
      ["pane.splitDown", "Split Down", "split-vertical"],
      ["pane.toggleZoom", "Toggle Zoom", "screen-full"],
    ]);
    for (const item of items) expect(item.shortcut).toBe(display(item.id));
    expect(items.every((i) => !i.danger)).toBe(true);
  });

  it("puts the separator on the first item and wires the handlers", () => {
    const h = { onSplitRight: vi.fn(), onSplitDown: vi.fn(), onToggleZoom: vi.fn() };
    const items = paneLayoutItems(h);
    expect(items[0].separatorBefore).toBe(true);
    expect(items[1].separatorBefore).toBeUndefined();
    items.forEach((i) => i.onSelect?.());
    expect(h.onSplitRight).toHaveBeenCalledOnce();
    expect(h.onSplitDown).toHaveBeenCalledOnce();
    expect(h.onToggleZoom).toHaveBeenCalledOnce();
  });
});

describe("closeItems", () => {
  it("lists Close Pane (danger) then Close Tab, the first with a separator", () => {
    const items = closeItems({ onClosePane: vi.fn(), onCloseTab: vi.fn() });
    expect(items.map((i) => [i.id, i.label, i.icon, !!i.danger])).toEqual([
      ["pane.close", "Close Pane", "chrome-close", true],
      ["tab.close", "Close Tab", "close", false],
    ]);
    expect(items[0].separatorBefore).toBe(true);
    expect(items[1].separatorBefore).toBeUndefined();
    expect(items[0].shortcut).toBe(display("pane.close"));
    expect(items[1].shortcut).toBe(display("tab.close"));
  });

  it("leaves out an item without a handler", () => {
    expect(closeItems({ onClosePane: vi.fn() }).map((i) => i.id)).toEqual(["pane.close"]);
    const tabOnly = closeItems({ onCloseTab: vi.fn() });
    expect(tabOnly.map((i) => i.id)).toEqual(["tab.close"]);
    expect(tabOnly[0].separatorBefore).toBe(true);
    expect(closeItems({})).toEqual([]);
  });
});
