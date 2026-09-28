// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `links.ts` imports `appApi.ts`,
// which imports `appDom.ts`'s top-level `document.getElementById(...)`
// lookups -- needed even though this file only exercises the pure
// `hoverCallAllowed` predicate below.

import { describe, expect, it } from "vitest";
import { hoverCallAllowed } from "../../src/links";

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
