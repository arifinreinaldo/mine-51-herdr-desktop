// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `scroll.ts` imports
// `appApi.ts`/`appLookups.ts`, whose top-level `document.getElementById(...)`
// lookups need a DOM even though this file only exercises the pure
// `pageScrollOffset` function below.

import { describe, expect, it } from "vitest";
import { pageScrollOffset } from "../../src/scroll";

describe("pageScrollOffset", () => {
  it("scrolls up by one viewport's worth of rows, clamped to max_offset_from_bottom", () => {
    const metrics = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 24 };
    expect(pageScrollOffset(metrics, "up")).toBe(24);
  });

  it("clamps an upward page scroll at the top of scrollback", () => {
    const metrics = { offset_from_bottom: 90, max_offset_from_bottom: 100, viewport_rows: 24 };
    expect(pageScrollOffset(metrics, "up")).toBe(100);
  });

  it("scrolls down by one viewport's worth of rows, clamped to 0", () => {
    const metrics = { offset_from_bottom: 30, max_offset_from_bottom: 100, viewport_rows: 24 };
    expect(pageScrollOffset(metrics, "down")).toBe(6);
  });

  it("clamps a downward page scroll at the live bottom", () => {
    const metrics = { offset_from_bottom: 10, max_offset_from_bottom: 100, viewport_rows: 24 };
    expect(pageScrollOffset(metrics, "down")).toBe(0);
  });

  it("uses at least a 1-row page for a degenerate 0-row viewport", () => {
    const metrics = { offset_from_bottom: 0, max_offset_from_bottom: 5, viewport_rows: 0 };
    expect(pageScrollOffset(metrics, "up")).toBe(1);
  });
});
