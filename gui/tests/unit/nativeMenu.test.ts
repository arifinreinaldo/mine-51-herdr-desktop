import { describe, expect, it, vi } from "vitest";
import { glyphToAccelerator, toNativeMenus } from "../../src/nativeMenu";
import { buildMacShortcuts, SHORTCUTS } from "../../src/shortcuts";

describe("glyphToAccelerator", () => {
  it("turns Apple glyph combos into accelerators", () => {
    expect(glyphToAccelerator("⌘T")).toBe("Cmd+T");
    expect(glyphToAccelerator("⇧⌘W")).toBe("Cmd+Shift+W");
    expect(glyphToAccelerator("⌥⌘1")).toBe("Cmd+Alt+1");
    expect(glyphToAccelerator("⌥⌘←")).toBe("Cmd+Alt+Left");
    expect(glyphToAccelerator("⇧⌘Return")).toBe("Cmd+Shift+Enter");
    expect(glyphToAccelerator("⌘,")).toBe("Cmd+,");
    expect(glyphToAccelerator("⌘=")).toBe("Cmd+=");
  });

  it("uses the first combo of an alias", () => {
    expect(glyphToAccelerator("⇧⌘] / ⌃Tab")).toBe("Cmd+Shift+]");
  });

  it("refuses combos without Cmd, or with a key it cannot name", () => {
    expect(glyphToAccelerator("⌃`")).toBeNull();
    expect(glyphToAccelerator("F2")).toBeNull();
    expect(glyphToAccelerator("Ctrl+Shift+T")).toBeNull();
    expect(glyphToAccelerator("⇧Fn↑")).toBeNull();
    expect(glyphToAccelerator("⌘PgUp")).toBeNull();
    expect(glyphToAccelerator(undefined)).toBeNull();
  });

  it("every Mac shortcut display is either accelerated or deliberately left out", () => {
    const mac = buildMacShortcuts(SHORTCUTS);
    const left = mac.filter((a) => glyphToAccelerator(a.display) === null).map((a) => a.id).sort();
    expect(left).toEqual(["pane.scrollPageDown", "pane.scrollPageUp", "tab.rename", "tab.togglePrevious"]);
  });
});

describe("toNativeMenus", () => {
  const onNew = vi.fn();
  const onTheme = vi.fn();
  const { spec, handlers } = toNativeMenus([
    {
      name: "tab",
      title: "Tab",
      items: [
        { id: "tab.new", label: "New Tab", shortcut: "⌘T", onSelect: onNew },
        { id: "tab.close", label: "Close Tab", disabled: true, separatorBefore: true, onSelect: () => {} },
      ],
    },
    {
      name: "view",
      title: "View",
      items: [
        {
          id: "view.theme",
          label: "Theme",
          submenu: [{ id: "theme.dark", label: "Dark", checked: true, onSelect: onTheme }],
        },
      ],
    },
  ]);

  it("keeps menu order, labels, accelerators, enabled and separators", () => {
    expect(spec.map((m) => m.title)).toEqual(["Tab", "View"]);
    expect(spec[0].items[0]).toMatchObject({ label: "New Tab", accelerator: "Cmd+T", enabled: true, separatorBefore: false });
    expect(spec[0].items[1]).toMatchObject({ enabled: false, separatorBefore: true });
    expect(spec[0].items[1].accelerator).toBeUndefined();
  });

  it("converts submenus and checked state", () => {
    const theme = spec[1].items[0];
    expect(theme.submenu).toHaveLength(1);
    expect(theme.submenu[0].checked).toBe(true);
  });

  it("gives every item a unique id and routes a click to its action", () => {
    const ids = [spec[0].items[0].id, spec[0].items[1].id, spec[1].items[0].id, spec[1].items[0].submenu[0].id];
    expect(new Set(ids).size).toBe(ids.length);
    handlers.get(spec[0].items[0].id)?.();
    handlers.get(spec[1].items[0].submenu[0].id)?.();
    expect(onNew).toHaveBeenCalledOnce();
    expect(onTheme).toHaveBeenCalledOnce();
    expect(handlers.has(spec[1].items[0].id)).toBe(false); // a submenu parent has no action
  });
});
