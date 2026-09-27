import { afterEach, describe, expect, it, vi } from "vitest";
import { hasTabUiFocus, routeKeydown, type KeyboardRoutingHandlers } from "../../../src/keyboard/routing";
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
} {
  const shortcuts: string[] = [];
  const terminalKeys: unknown[] = [];
  let pastes = 0;
  return {
    onShortcut: (a) => shortcuts.push(a.id),
    onTerminalKey: (m) => terminalKeys.push(m),
    onPasteOverride: () => {
      pastes++;
    },
    shortcuts,
    terminalKeys,
    get pastes() {
      return pastes;
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
