import { describe, expect, it } from "vitest";
import type { KeyCombo } from "../../src/shortcuts";
import {
  cheatSheetEntries,
  filterCheatSheetEntries,
  findShortcut,
  groupCheatSheetEntriesByMenu,
  isAllowedShortcutClass,
  isPlainCtrlLetter,
  buildMacShortcuts,
  matchesCombo,
  SHORTCUTS,
} from "../../src/shortcuts";

// Keyboard shortcuts feature (Alt+1..9 tab focus, Ctrl+Shift+1..9 workspace
// focus, Alt+` toggle previous tab, Ctrl+Shift+E focus sidebar, Ctrl+Shift+/
// keyboard shortcuts modal): `isAllowedShortcutClass` widened to also allow
// the two new alt-only classes this feature introduces (`Alt+1..9`,
// `Alt+\``). `Ctrl+Shift+1..9`/`+E`/`+/` need no widening -- they already
// fit the pre-existing `Ctrl+Shift+*` class. The assertion itself (every
// `SHORTCUTS` entry, generically) is unchanged, so it automatically covers
// every one of the new entries below with no per-entry edit needed.
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

  // Terminal-parity spec P0 #1: Ctrl+Shift+C is now claimed as Copy (it used
  // to be sent to the terminal as Ctrl+Shift+'c'); Ctrl+Shift+V stays
  // reserved -- `keyboard/routing.ts`'s own paste-override path handles it
  // while the terminal has focus, spec §1.
  it("Ctrl+Shift+C is claimed as pane.copy; Ctrl+Shift+V stays reserved (not claimed)", () => {
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyC" }, false)?.id,
    ).toBe("pane.copy");
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyV" }, false),
    ).toBeUndefined();
  });

  // Terminal-parity spec P0 #4/P1 #7/#8/#10/#12: the new bare-Shift class
  // (Paste, scrollback) and the remaining Ctrl+Shift+* claims (Find, Clear,
  // Copy Mode) all resolve to their own shortcut ids.
  it("resolves every new terminal-parity shortcut", () => {
    const cases: Array<[Partial<KeyCombo>, string]> = [
      [{ ctrl: true, shift: true, alt: false, code: "KeyF" }, "pane.find"],
      [{ ctrl: true, shift: true, alt: false, code: "KeyK" }, "pane.clear"],
      [{ ctrl: true, shift: true, alt: false, code: "Space" }, "pane.copyMode"],
      [{ ctrl: false, shift: true, alt: false, code: "Insert" }, "pane.paste"],
      [{ ctrl: false, shift: true, alt: false, code: "PageUp" }, "pane.scrollPageUp"],
      [{ ctrl: false, shift: true, alt: false, code: "PageDown" }, "pane.scrollPageDown"],
      [{ ctrl: false, shift: true, alt: false, code: "Home" }, "pane.scrollToTop"],
      [{ ctrl: false, shift: true, alt: false, code: "End" }, "pane.scrollToBottom"],
    ];
    for (const [combo, id] of cases) {
      expect(
        findShortcut(
          { ctrlKey: combo.ctrl ?? false, shiftKey: combo.shift ?? false, altKey: combo.alt ?? false, code: combo.code! },
          false,
        )?.id,
      ).toBe(id);
    }
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

describe("findShortcut: keyboard shortcuts feature", () => {
  it("Alt+1..8 resolve to tab.focusByIndex.<n>, Alt+9 to the last-tab entry", () => {
    for (let n = 1; n <= 9; n++) {
      expect(
        findShortcut({ ctrlKey: false, shiftKey: false, altKey: true, code: `Digit${n}` }, false)?.id,
      ).toBe(`tab.focusByIndex.${n}`);
    }
  });

  it("Ctrl+Shift+1..8 resolve to workspace.focusByIndex.<n>, Ctrl+Shift+9 to the last-workspace entry", () => {
    for (let n = 1; n <= 9; n++) {
      expect(
        findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: `Digit${n}` }, false)?.id,
      ).toBe(`workspace.focusByIndex.${n}`);
    }
  });

  it("Alt+` resolves to tab.togglePrevious", () => {
    expect(
      findShortcut({ ctrlKey: false, shiftKey: false, altKey: true, code: "Backquote" }, false)?.id,
    ).toBe("tab.togglePrevious");
  });

  it("Ctrl+Shift+E resolves to view.focusSidebar", () => {
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyE" }, false)?.id,
    ).toBe("view.focusSidebar");
  });

  it("Ctrl+Shift+/ resolves to herdr.showShortcuts", () => {
    expect(
      findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "Slash" }, false)?.id,
    ).toBe("herdr.showShortcuts");
  });

  it("a plain Alt+1 (no Ctrl/Shift) is not confused with Alt+Shift+1 (unclaimed)", () => {
    expect(
      findShortcut({ ctrlKey: false, shiftKey: true, altKey: true, code: "Digit1" }, false),
    ).toBeUndefined();
  });
});

describe("cheatSheetEntries / filterCheatSheetEntries / groupCheatSheetEntriesByMenu", () => {
  it("collapses each 9-wide focus-by-index range into a single entry", () => {
    const entries = cheatSheetEntries();
    const tabRange = entries.filter((e) => e.id === "tab.focusByIndex");
    const workspaceRange = entries.filter((e) => e.id === "workspace.focusByIndex");
    expect(tabRange).toHaveLength(1);
    expect(workspaceRange).toHaveLength(1);
    expect(tabRange[0].display).toBe("Alt+1 … Alt+9");
    expect(workspaceRange[0].display).toBe("Ctrl+Shift+1 … Ctrl+Shift+9");
  });

  it("single source of truth: every non-ranged SHORTCUTS entry, plus one per range, appears exactly once", () => {
    const entries = cheatSheetEntries();
    const expectedIds = new Set<string>();
    for (const action of SHORTCUTS) {
      expectedIds.add(action.rangeGroup ?? action.id);
    }
    expect(new Set(entries.map((e) => e.id))).toEqual(expectedIds);
    expect(entries).toHaveLength(expectedIds.size);
  });

  it("filters case-insensitively by label text", () => {
    const entries = cheatSheetEntries();
    const filtered = filterCheatSheetEntries(entries, "SPLIT right");
    expect(filtered.map((e) => e.id)).toEqual(["pane.splitRight"]);
  });

  it("filters by key/display text too", () => {
    const entries = cheatSheetEntries();
    const filtered = filterCheatSheetEntries(entries, "ctrl+shift+n");
    expect(filtered.map((e) => e.id)).toEqual(["workspace.new"]);
  });

  it("an empty query returns every entry, unfiltered", () => {
    const entries = cheatSheetEntries();
    expect(filterCheatSheetEntries(entries, "   ")).toHaveLength(entries.length);
  });

  it("a query matching nothing returns an empty list", () => {
    const entries = cheatSheetEntries();
    expect(filterCheatSheetEntries(entries, "no such shortcut")).toEqual([]);
  });

  it("groups by menu in the spec's fixed order, skipping menus with no entries", () => {
    const groups = groupCheatSheetEntriesByMenu(cheatSheetEntries());
    const menuNames = groups.map(([menu]) => menu);
    expect(menuNames).toEqual(["Workspace", "Tab", "Pane", "Agents", "View", "herdr"]);
    // "Help" has no ShortcutAction of its own (its menu item has no
    // keyboard shortcut), so it must not appear as an empty group.
    expect(menuNames).not.toContain("Help");
  });

  it("grouping after filtering only includes menus with a surviving match", () => {
    const filtered = filterCheatSheetEntries(cheatSheetEntries(), "split");
    const groups = groupCheatSheetEntriesByMenu(filtered);
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe("Pane");
  });
});

describe("macOS shortcut table", () => {
  const mac = buildMacShortcuts(SHORTCUTS);
  const byId = (id: string) => mac.find((a) => a.id === id)!;
  const press = (code: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) => ({
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    code,
    ...mods,
  });
  const allCombos = (a: (typeof mac)[number]) => [a.combo, ...(a.altCombos ?? [])];

  it("never claims plain Option, and Ctrl only for tab cycling and previous-tab", () => {
    const optionOnly = mac.flatMap(allCombos).filter((c) => c.alt && !c.meta);
    expect(optionOnly).toEqual([]);
    const ctrl = mac.flatMap((a) => allCombos(a).filter((c) => c.ctrl).map(() => a.id)).sort();
    expect(ctrl).toEqual(["tab.next", "tab.previous", "tab.togglePrevious"]);
  });

  it("every combo is in an allowed class and no two actions share a combo", () => {
    expect(mac.filter((a) => !isAllowedShortcutClass(a)).map((a) => a.id)).toEqual([]);
    const keys = mac.flatMap((a) =>
      allCombos(a).map((c) => JSON.stringify([c.ctrl, c.shift, c.alt, !!c.meta, c.code, !!a.requiresTabFocus])),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps ids unique and every non-extra id inside the Windows table", () => {
    const ids = mac.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const windowsIds = new Set(SHORTCUTS.map((a) => a.id));
    const extras = ids.filter((id) => !windowsIds.has(id)).sort();
    expect(extras).toEqual(["pane.focusDown", "pane.focusLeft", "pane.focusRight", "pane.focusUp"]);
  });

  it("matches the agreed layout", () => {
    const shown = (id: string) => byId(id).display;
    expect(shown("tab.new")).toBe("⌘T");
    expect(shown("tab.close")).toBe("⌘W");
    expect(shown("pane.close")).toBe("⇧⌘W");
    expect(shown("pane.splitRight")).toBe("⌘D");
    expect(shown("pane.splitDown")).toBe("⇧⌘D");
    expect(shown("pane.toggleZoom")).toBe("⇧⌘Return");
    expect(shown("workspace.new")).toBe("⌘N");
    expect(shown("tab.focusByIndex.1")).toBe("⌘1");
    expect(shown("workspace.focusByIndex.1")).toBe("⌥⌘1");
    expect(shown("pane.focusLeft")).toBe("⌥⌘←");
    expect(shown("herdr.showShortcuts")).toBe("⌘/");
    expect(shown("agents.jumpToNextNeedingAttention")).toBe("⌘J");
  });

  it("leaves Move Tab unbound (drag reorders)", () => {
    expect(mac.find((a) => a.id === "tab.moveLeft")).toBeUndefined();
    expect(mac.find((a) => a.id === "tab.moveRight")).toBeUndefined();
  });

  it("accepts the alias combos and requires Cmd for the primary", () => {
    const next = byId("tab.next");
    expect(matchesCombo(next.combo, press("BracketRight", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(next.altCombos!.some((c) => matchesCombo(c, press("Tab", { ctrlKey: true })))).toBe(true);
    expect(matchesCombo(next.combo, press("BracketRight", { shiftKey: true }))).toBe(false);
    const zoomIn = byId("view.zoomIn");
    expect(zoomIn.altCombos!.some((c) => matchesCombo(c, press("Equal", { metaKey: true, shiftKey: true })))).toBe(true);
  });

  it("Cmd+Option+1 focuses a workspace, Cmd+1 a tab, and they do not collide", () => {
    expect(matchesCombo(byId("workspace.focusByIndex.1").combo, press("Digit1", { metaKey: true, altKey: true }))).toBe(true);
    expect(matchesCombo(byId("tab.focusByIndex.1").combo, press("Digit1", { metaKey: true }))).toBe(true);
    expect(matchesCombo(byId("tab.focusByIndex.1").combo, press("Digit1", { metaKey: true, altKey: true }))).toBe(false);
  });

  it("Windows actions never match a Cmd press, and the Windows table is untouched", () => {
    expect(findShortcut(press("KeyT", { ctrlKey: true, shiftKey: true, metaKey: true }), false)).toBeUndefined();
    expect(SHORTCUTS.find((a) => a.id === "tab.new")?.display).toBe("Ctrl+Shift+T");
  });
});
