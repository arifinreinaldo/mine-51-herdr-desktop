// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `copyMode.ts` imports
// `appApi.ts`/`appDom.ts`'s top-level `document.getElementById(...)`
// lookups, needed even for the DOM-free assertions below.

import { describe, expect, it } from "vitest";
import { clampToPaneBounds, handleCopyModeKeydown, isCopyModeActive } from "../../src/copyMode";

describe("clampToPaneBounds", () => {
  it("clamps within [0, maxRow] x [0, width - 1]", () => {
    expect(clampToPaneBounds({ row: -1, col: -1 }, 10, 5)).toEqual({ row: 0, col: 0 });
    expect(clampToPaneBounds({ row: 20, col: 20 }, 10, 5)).toEqual({ row: 10, col: 4 });
    expect(clampToPaneBounds({ row: 5, col: 2 }, 10, 5)).toEqual({ row: 5, col: 2 });
  });

  it("never goes negative for a degenerate 0-width/0-row pane", () => {
    expect(clampToPaneBounds({ row: 3, col: 3 }, 0, 0)).toEqual({ row: 0, col: 0 });
  });
});

describe("isCopyModeActive / handleCopyModeKeydown with no active session", () => {
  it("is inactive until enterCopyMode succeeds", () => {
    expect(isCopyModeActive()).toBe(false);
  });

  it("handleCopyModeKeydown consumes nothing with no active session", () => {
    expect(handleCopyModeKeydown({ key: "h", ctrlKey: false, altKey: false, metaKey: false })).toBe(false);
    expect(handleCopyModeKeydown({ key: "Escape", ctrlKey: false, altKey: false, metaKey: false })).toBe(false);
  });
});
