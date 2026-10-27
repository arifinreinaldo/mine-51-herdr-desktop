// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `links.ts` imports `appApi.ts`,
// which imports `appDom.ts`'s top-level `document.getElementById(...)`
// lookups -- needed even though this file only exercises the pure
// `hoverCallAllowed` predicate below.

import { describe, expect, it } from "vitest";
import { hoverCallAllowed, isUnsupportedMethod, pathAtColumn } from "../../src/links";

describe("hoverCallAllowed", () => {
  it("always allows the first call (lastCallAt is null)", () => {
    expect(hoverCallAllowed(null, 1000)).toBe(true);
  });

  it("disallows a call within the throttle interval", () => {
    expect(hoverCallAllowed(1000, 1050)).toBe(false);
  });

  it("allows a call once the interval has elapsed", () => {
    expect(hoverCallAllowed(1000, 1100)).toBe(true);
  });

  it("respects a custom interval", () => {
    expect(hoverCallAllowed(1000, 1010, 50)).toBe(false);
    expect(hoverCallAllowed(1000, 1050, 50)).toBe(true);
  });
});

describe("isUnsupportedMethod", () => {
  it("matches the server's unsupported_method error", () => {
    const err = { message: 'unsupported_method: method "pane.link.resolve" is not available on this machine' };
    expect(isUnsupportedMethod(err)).toBe(true);
  });
  it("does not match other errors", () => {
    expect(isUnsupportedMethod({ message: "pane_not_found: gone" })).toBe(false);
    expect(isUnsupportedMethod("boom")).toBe(false);
  });
});

describe("pathAtColumn", () => {
  const ROW = "  I've exported it to C:\\Users\\Reinaldo\\stockbit-portfolio\\research_2026-10-27.xlsx. It has";

  it("finds the path under the column and trims trailing punctuation", () => {
    const m = pathAtColumn(ROW, 30, 4);
    expect(m?.path).toBe("C:\\Users\\Reinaldo\\stockbit-portfolio\\research_2026-10-27.xlsx");
    expect(m?.region.row).toBe(4);
    expect(m?.region.end_col).toBe(m!.region.start_col + m!.path.length - 1);
  });

  it("returns null outside the path or on a row without one", () => {
    expect(pathAtColumn(ROW, 2)).toBeNull();
    expect(pathAtColumn("no path here", 3)).toBeNull();
  });
});
