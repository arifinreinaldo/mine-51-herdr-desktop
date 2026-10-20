// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `routing.ts` now imports
// `copyMode.ts` (P1 #8), which imports `appApi.ts`/`appDom.ts`'s top-level
// `document.getElementById(...)` lookups.

import { afterEach, describe, expect, it, vi } from "vitest";
import { hasTabUiFocus, installKeyboardRouting, routeKeydown, routeKeyup, type KeyboardRoutingHandlers } from "../../../src/keyboard/routing";
import { closeActiveOverlay, openOverlay } from "../../../src/ui/overlay";

function fakeElement(classes: string[] = []): Element {
  return {
    classList: { contains: (c: string) => classes.includes(c) },
  } as unknown as Element;
}

function fakeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    isComposing: false,
    keyCode: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    key: "",
    code: "",
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function fakeHandlers(): KeyboardRoutingHandlers & {
  shortcuts: string[];
  terminalKeys: unknown[];
  pastes: number;
  textCommits: string[];
  fileTabActions: string[];
  doubleShifts: number;
} {
  const shortcuts: string[] = [];
  const terminalKeys: unknown[] = [];
  const textCommits: string[] = [];
  const fileTabActions: string[] = [];
  let pastes = 0;
  let doubleShifts = 0;
  return {
    onShortcut: (a) => shortcuts.push(a.id),
    onTerminalKey: (m) => terminalKeys.push(m),
    onPasteOverride: () => {
      pastes++;
    },
    onTerminalTextCommit: (text) => textCommits.push(text),
    onFileTabAction: (id) => fileTabActions.push(id),
    onDoubleShift: () => {
      doubleShifts++;
    },
    shortcuts,
    terminalKeys,
    textCommits,
    fileTabActions,
    get pastes() {
      return pastes;
    },
    get doubleShifts() {
      return doubleShifts;
    },
  };
}

describe("hasTabUiFocus", () => {
  it("is true only for a .tab element", () => {
    expect(hasTabUiFocus(fakeElement(["tab"]))).toBe(true);
    expect(hasTabUiFocus(fakeElement(["ws"]))).toBe(false);
    expect(hasTabUiFocus(null)).toBe(false);
  });
});

describe("routeKeydown", () => {
  it("step 1: ignores IME composition", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ isComposing: true, ctrlKey: true, shiftKey: true, code: "KeyN" });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.shortcuts).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("step 1: ignores keyCode 229 (IME)", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ keyCode: 229, ctrlKey: true, shiftKey: true, code: "KeyN" });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.shortcuts).toEqual([]);
  });

  it("step 2: a claimed shortcut fires regardless of what has focus", () => {
    const capture = fakeElement();
    const somethingElse = fakeElement(["ws"]);
    const handlers = fakeHandlers();
    const event = fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyN" });
    routeKeydown(event, capture, somethingElse, handlers);
    expect(handlers.shortcuts).toEqual(["workspace.new"]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("step 2: F2 only fires when a .tab has focus", () => {
    const capture = fakeElement();
    const tab = fakeElement(["tab"]);
    const handlers = fakeHandlers();
    routeKeydown(fakeEvent({ code: "F2" }), capture, tab, handlers);
    expect(handlers.shortcuts).toEqual(["tab.rename"]);
  });

  it("step 2: F2 does not fire when the terminal capture has focus (falls through to step 3 instead)", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    routeKeydown(fakeEvent({ key: "F2", code: "F2" }), capture, capture, handlers);
    expect(handlers.shortcuts).toEqual([]);
    // Falls through to the terminal as an F-key.
    expect(handlers.terminalKeys).toHaveLength(1);
  });

  it("step 3: an unclaimed named key with the capture focused goes to the terminal", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ key: "Enter", code: "Enter" });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.terminalKeys).toHaveLength(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("step 3: a plain printable character is left alone (falls through to the input event)", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ key: "a", code: "KeyA" });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.terminalKeys).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // P0 #2 "AltGr": checked before the ordinary key mapping, only while the
  // terminal capture has focus.
  it("AltGr (getModifierState) sends a text commit, not a key press", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({
      key: "@",
      code: "KeyQ",
      ctrlKey: true,
      altKey: true,
      getModifierState: (k: string) => k === "AltGraph",
    } as Partial<KeyboardEvent>);
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.textCommits).toEqual(["@"]);
    expect(handlers.terminalKeys).toEqual([]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("AltGr heuristic fallback (Ctrl+Alt, no AltGraph, non-letter key) also sends a text commit", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ key: "ą", code: "KeyA", ctrlKey: true, altKey: true });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.textCommits).toEqual(["ą"]);
    expect(handlers.terminalKeys).toEqual([]);
  });

  it("Ctrl+Alt+<ascii letter> with no AltGraph stays the ordinary Ctrl+Alt Char path", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.textCommits).toEqual([]);
    expect(handlers.terminalKeys).toHaveLength(1);
  });

  // Keyboard shortcuts feature: Alt+1 (a new claimed class, step 2) is
  // claimed even while the terminal capture has focus -- unlike a plain
  // Ctrl+<letter>, which per spec §1 always belongs to the terminal (Ctrl+K
  // in particular is a regression check: nothing about this feature may
  // start claiming it).
  it("step 2: Alt+1 is claimed even while the terminal capture has focus", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ altKey: true, code: "Digit1" });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.shortcuts).toEqual(["tab.focusByIndex.1"]);
    expect(handlers.terminalKeys).toEqual([]);
  });

  it("step 3: plain Ctrl+K still reaches the terminal, unclaimed", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const event = fakeEvent({ ctrlKey: true, key: "k", code: "KeyK" });
    routeKeydown(event, capture, capture, handlers);
    expect(handlers.shortcuts).toEqual([]);
    expect(handlers.terminalKeys).toHaveLength(1);
  });

  it("step 4: an unclaimed key with a chrome element focused does nothing", () => {
    const capture = fakeElement();
    const row = fakeElement(["ws"]);
    const handlers = fakeHandlers();
    const event = fakeEvent({ key: "ArrowDown", code: "ArrowDown" });
    routeKeydown(event, capture, row, handlers);
    expect(handlers.terminalKeys).toEqual([]);
    expect(handlers.shortcuts).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+V reads the clipboard only while the terminal capture has focus", () => {
    const capture = fakeElement();
    const row = fakeElement(["ws"]);
    const handlers = fakeHandlers();
    routeKeydown(
      fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyV" }),
      capture,
      capture,
      handlers,
    );
    expect(handlers.pastes).toBe(1);

    const handlers2 = fakeHandlers();
    routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyV" }), capture, row, handlers2);
    expect(handlers2.pastes).toBe(0);
  });

  // Git MVP plan step 17: paste and the scrollback keys are terminal-only on
  // every OS, so a text field (the commit box, the find bar) keeps its native
  // Shift+Insert paste and Shift+Home/End/PgUp/PgDn selection.
  it("step 2: Shift+Insert and the Shift scrollback keys act on the terminal only while the capture has focus", () => {
    const capture = fakeElement();
    const textField = fakeElement();
    for (const code of ["Insert", "PageUp", "PageDown", "Home", "End"]) {
      const handlers = fakeHandlers();
      const event = fakeEvent({ shiftKey: true, key: code, code });
      routeKeydown(event, capture, textField, handlers);
      expect(handlers.shortcuts).toEqual([]);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const handlers = fakeHandlers();
    routeKeydown(fakeEvent({ shiftKey: true, key: "Insert", code: "Insert" }), capture, capture, handlers);
    expect(handlers.shortcuts).toEqual(["pane.paste"]);
  });

  // File viewer spec §8.1: while focus is inside #file-viewer, the tab keys act on the file tabs.
  it("tab.close, tab.next and tab.previous go to the file tabs while focus is inside #file-viewer", () => {
    const capture = fakeElement();
    const viewer = document.createElement("div");
    viewer.id = "file-viewer";
    const inner = document.createElement("div");
    viewer.appendChild(inner);
    const handlers = fakeHandlers();
    routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyW" }), capture, inner, handlers);
    routeKeydown(fakeEvent({ ctrlKey: true, key: "Tab", code: "Tab" }), capture, viewer, handlers);
    routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, key: "Tab", code: "Tab" }), capture, viewer, handlers);
    expect(handlers.fileTabActions).toEqual(["tab.close", "tab.next", "tab.previous"]);
    expect(handlers.shortcuts).toEqual([]);
    routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyW" }), capture, capture, handlers);
    expect(handlers.shortcuts).toEqual(["tab.close"]);
  });

  it("other shortcuts inside #file-viewer still reach onShortcut", () => {
    const viewer = document.createElement("div");
    viewer.id = "file-viewer";
    const handlers = fakeHandlers();
    routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyN" }), fakeElement(), viewer, handlers);
    expect(handlers.shortcuts).toEqual(["workspace.new"]);
    expect(handlers.fileTabActions).toEqual([]);
  });

  // Finding #4: an overlay (menu/popover/modal/confirm) that opened without
  // moving keyboard focus off the terminal capture (a hover-opened popover,
  // an auto-opened agent popover) must not have Esc forwarded to the
  // terminal instead of closing it.
  describe("Esc and open overlays (finding #4)", () => {
    afterEach(() => {
      closeActiveOverlay(); // never leak an open overlay into the next test
    });

    it("Esc closes the open overlay instead of reaching the terminal when the capture still has focus", () => {
      const capture = fakeElement();
      const handlers = fakeHandlers();
      const dispose = vi.fn();
      openOverlay(dispose);

      const event = fakeEvent({ key: "Escape", code: "Escape" });
      routeKeydown(event, capture, capture, handlers);

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(handlers.terminalKeys).toEqual([]);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("Esc reaches the terminal as usual when no overlay is open", () => {
      const capture = fakeElement();
      const handlers = fakeHandlers();
      const event = fakeEvent({ key: "Escape", code: "Escape" });
      routeKeydown(event, capture, capture, handlers);
      expect(handlers.terminalKeys).toHaveLength(1);
    });

    // Finding #3: an overlay opened with `escapableFromOutside: false` (a
    // *pinned* agent popover) must not be closed by this central-router
    // rule -- Esc instead falls through to step 3 (the terminal), exactly
    // as if no overlay were open at all. The popover's own keydown
    // listener is the only thing that may close it on Esc, and only when
    // focus is actually inside it.
    it("Esc reaches the terminal instead of closing an overlay marked non-escapable-from-outside", () => {
      const capture = fakeElement();
      const handlers = fakeHandlers();
      const dispose = vi.fn();
      openOverlay(dispose, { escapableFromOutside: false });

      const event = fakeEvent({ key: "Escape", code: "Escape" });
      routeKeydown(event, capture, capture, handlers);

      expect(dispose).not.toHaveBeenCalled();
      expect(handlers.terminalKeys).toHaveLength(1);
    });

    it("Esc does not pre-empt a chrome widget's own handling when focus is not on the capture", () => {
      // A menu/submenu already moves focus onto its own item, so its own
      // listener handles Esc (e.g. finding #1's "close just the submenu");
      // the central router must stay out of the way in that case even
      // though an overlay is open.
      const capture = fakeElement();
      const menuItem = fakeElement(["menu-item"]);
      const handlers = fakeHandlers();
      const dispose = vi.fn();
      openOverlay(dispose);

      const event = fakeEvent({ key: "Escape", code: "Escape" });
      routeKeydown(event, capture, menuItem, handlers);

      expect(dispose).not.toHaveBeenCalled();
      expect(handlers.terminalKeys).toEqual([]);
      expect(handlers.shortcuts).toEqual([]);
    });
  });
});

// File viewer spec §7.1: double-Shift opens Find File from any focus target.
describe("double-Shift", () => {
  afterEach(() => {
    closeActiveOverlay();
  });

  const shift = (timeStamp: number) => fakeEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true, timeStamp });
  const keyH = (timeStamp: number) => fakeEvent({ key: "H", code: "KeyH", shiftKey: true, timeStamp });

  function doubleTap(capture: Element, handlers: ReturnType<typeof fakeHandlers>, t0: number): void {
    routeKeydown(shift(t0), capture, capture, handlers);
    routeKeyup(shift(t0 + 60));
    routeKeydown(shift(t0 + 200), capture, capture, handlers);
  }

  it("opens Find File from the terminal capture and sends nothing to the terminal", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    doubleTap(capture, handlers, 1_000);
    expect(handlers.doubleShifts).toBe(1);
    expect(handlers.terminalKeys).toEqual([]);
  });

  it("does not fire while an overlay is open", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    openOverlay(vi.fn());
    doubleTap(capture, handlers, 10_000);
    expect(handlers.doubleShifts).toBe(0);
  });

  it("still fires over a pinned agent popover (escapableFromOutside: false)", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    openOverlay(vi.fn(), { escapableFromOutside: false });
    doubleTap(capture, handlers, 20_000);
    expect(handlers.doubleShifts).toBe(1);
  });

  it("does not fire while typing in a text field, but fires from other non-capture focus", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    const tap = (target: Element, t0: number) => {
      routeKeydown(shift(t0), capture, target, handlers);
      routeKeyup(shift(t0 + 60));
      routeKeydown(shift(t0 + 200), capture, target, handlers);
    };
    const input = document.createElement("input");
    tap(input, 30_000);
    expect(handlers.doubleShifts).toBe(0);
    tap(document.createElement("div"), 40_000);
    expect(handlers.doubleShifts).toBe(1);
  });

  // Review W7: without the H cancel, each of these two sequences would fire.
  it("Shift↓ H↓ Shift↑ then Shift↓ (typing a capital) does not fire", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    routeKeydown(shift(30_000), capture, capture, handlers);
    routeKeydown(keyH(30_020), capture, capture, handlers);
    routeKeyup(shift(30_050));
    routeKeydown(shift(30_300), capture, capture, handlers);
    expect(handlers.doubleShifts).toBe(0);
  });

  it("Shift↓ Shift↑ H↓ Shift↓ does not fire", () => {
    const capture = fakeElement();
    const handlers = fakeHandlers();
    routeKeydown(shift(40_000), capture, capture, handlers);
    routeKeyup(shift(40_030));
    routeKeydown(keyH(40_060), capture, capture, handlers);
    routeKeydown(shift(40_100), capture, capture, handlers);
    expect(handlers.doubleShifts).toBe(0);
  });

  it("installKeyboardRouting: a wheel turn or a pointer press between the taps cancels them", () => {
    const handlers = fakeHandlers();
    const dispose = installKeyboardRouting(document.createElement("textarea"), handlers);
    const key = (type: string) =>
      document.dispatchEvent(new KeyboardEvent(type, { key: "Shift", code: "ShiftLeft", shiftKey: type === "keydown" }));
    try {
      for (const between of ["wheel", "pointerdown"]) {
        key("keydown");
        key("keyup");
        document.dispatchEvent(new Event(between));
        key("keydown"); // tap 1 again, no fire
        document.dispatchEvent(new Event(between)); // clear before the next round
      }
      expect(handlers.doubleShifts).toBe(0);
      key("keydown");
      key("keyup");
      key("keydown");
      expect(handlers.doubleShifts).toBe(1);
    } finally {
      dispose();
    }
  });
});
