import { describe, expect, it } from "vitest";
import {
  buildMouseEvent,
  DEFAULT_MOUSE_SCROLL_LINES,
  domModifierBits,
  pointerButtonsBit,
  pointerButtonToWire,
} from "../../../src/mouse/mouseWire";
import { MODIFIER_CONTROL, MODIFIER_SHIFT } from "../../../src/input/keymap";

describe("buildMouseEvent", () => {
  it("matches herdr_wire::ClientPaneInputEvent::Mouse's externally-tagged JSON shape", () => {
    // `{ Down: "Left" }` for `ClientMouseKind::Down(ClientMouseButton::Left)`,
    // `{ Cell: { column, row } }` for `ClientMousePosition::Cell`, `geometry:
    // null` (the GUI never reports SGR-pixel geometry) -- same convention as
    // `appTerminalInput.ts`'s existing `keyEvent`/`keyCodeToWire` for `Key`.
    expect(buildMouseEvent({ Down: "Left" }, 3, 5, 0)).toEqual({
      Mouse: {
        kind: { Down: "Left" },
        position: { Cell: { column: 3, row: 5 } },
        geometry: null,
        modifiers: 0,
        lines: DEFAULT_MOUSE_SCROLL_LINES,
      },
    });
  });

  it("passes a unit-variant kind through as a bare string", () => {
    expect(buildMouseEvent("Moved", 1, 2, 0).Mouse.kind).toBe("Moved");
  });

  it("carries an explicit lines count for wheel events", () => {
    expect(buildMouseEvent("ScrollUp", 0, 0, 0, 4).Mouse.lines).toBe(4);
  });

  it("carries the modifiers byte through unchanged", () => {
    expect(buildMouseEvent({ Up: "Right" }, 0, 0, MODIFIER_SHIFT | MODIFIER_CONTROL).Mouse.modifiers).toBe(
      MODIFIER_SHIFT | MODIFIER_CONTROL,
    );
  });
});

describe("pointerButtonToWire", () => {
  it("maps DOM PointerEvent.button values to ClientMouseButton", () => {
    expect(pointerButtonToWire(0)).toBe("Left");
    expect(pointerButtonToWire(1)).toBe("Middle");
    expect(pointerButtonToWire(2)).toBe("Right");
  });

  it("returns null for an unmapped button", () => {
    expect(pointerButtonToWire(3)).toBeNull();
    expect(pointerButtonToWire(4)).toBeNull();
  });
});

describe("pointerButtonsBit", () => {
  it("matches the DOM MouseEvent.buttons bitmask convention", () => {
    expect(pointerButtonsBit(0)).toBe(1); // left
    expect(pointerButtonsBit(2)).toBe(2); // right
    expect(pointerButtonsBit(1)).toBe(4); // middle
  });

  it("is 0 for an unmapped button, matching no real buttons value", () => {
    expect(pointerButtonsBit(5)).toBe(0);
  });
});

describe("domModifierBits", () => {
  it("reuses the shared crossterm-shaped modifier byte", () => {
    expect(domModifierBits({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })).toBe(
      MODIFIER_SHIFT,
    );
    expect(domModifierBits({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false })).toBe(0);
  });
});
