import { describe, expect, it } from "vitest";
import {
  findShortcut,
  isAllowedShortcutClass,
  isPlainCtrlLetter,
  SHORTCUTS,
} from "../../src/shortcuts";

describe("SHORTCUTS", () => {
  it("every claimed shortcut is in one of spec §1's allowed classes", () => {
    for (const action of SHORTCUTS) {
      expect(isAllowedShortcutClass(action), `${action.id} (${action.display})`).toBe(true);
    }
  });

  it("never claims a plain Ctrl+<letter> combo", () => {
    for (const action of SHORTCUTS) {
      expect(isPlainCtrlLetter(action.combo), `${action.id} (${action.display})`).toBe(false);
    }
  });

  it("has no duplicate key combos", () => {
    const seen = new Set<string>();
    for (const action of SHORTCUTS) {
      const key = `${action.combo.ctrl}-${action.combo.shift}-${action.combo.alt}-${action.combo.code}`;
      expect(seen.has(key), `duplicate combo for ${action.id}: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("has no duplicate ids", () => {
    const ids = SHORTCUTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("plain Ctrl+T is never claimed (it belongs to the terminal)", () => {
    const found = findShortcut({ ctrlKey: true, shiftKey: false, altKey: false, code: "KeyT" }, false);
    expect(found).toBeUndefined();
  });

  it("Ctrl+Shift+C and Ctrl+Shift+V stay reserved (not claimed)", () => {
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyC" }, false),
    ).toBeUndefined();
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyV" }, false),
    ).toBeUndefined();
  });
});

describe("findShortcut", () => {
  it("finds Ctrl+Shift+N as workspace.new", () => {
    const found = findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyN" }, false);
    expect(found?.id).toBe("workspace.new");
  });

  it("F2 only matches when a tab has UI focus", () => {
    const event = { ctrlKey: false, shiftKey: false, altKey: false, code: "F2" };
    expect(findShortcut(event, false)).toBeUndefined();
    expect(findShortcut(event, true)?.id).toBe("tab.rename");
  });

  it("distinguishes Ctrl+Tab from Ctrl+Shift+Tab", () => {
    expect(
      findShortcut({ ctrlKey: true, shiftKey: false, altKey: false, code: "Tab" }, false)?.id,
    ).toBe("tab.next");
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "Tab" }, false)?.id,
    ).toBe("tab.previous");
  });

  it("matches symbol keys by code, unaffected by the modifiers that would change event.key", () => {
    // Alt+Shift+Equal must resolve to Split Right regardless of what
    // event.key a browser would report for Shift+"=" (typically "+").
    expect(
      findShortcut({ ctrlKey: false, shiftKey: true, altKey: true, code: "Equal" }, false)?.id,
    ).toBe("pane.splitRight");
  });
});
