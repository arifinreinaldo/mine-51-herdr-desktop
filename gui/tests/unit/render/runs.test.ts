import { describe, expect, it } from "vitest";
import { mergeBackgroundRuns } from "../../../src/render/runs";

describe("mergeBackgroundRuns", () => {
  it("merges a uniform row into one run", () => {
    expect(mergeBackgroundRuns([1, 1, 1, 1])).toEqual([{ startX: 0, count: 4, bg: 1 }]);
  });

  it("splits on a bg change", () => {
    expect(mergeBackgroundRuns([1, 1, 2, 2, 2])).toEqual([
      { startX: 0, count: 2, bg: 1 },
      { startX: 2, count: 3, bg: 2 },
    ]);
  });

  it("handles a fully alternating row as one run per cell", () => {
    expect(mergeBackgroundRuns([1, 2, 1, 2])).toEqual([
      { startX: 0, count: 1, bg: 1 },
      { startX: 1, count: 1, bg: 2 },
      { startX: 2, count: 1, bg: 1 },
      { startX: 3, count: 1, bg: 2 },
    ]);
  });

  it("handles an empty row", () => {
    expect(mergeBackgroundRuns([])).toEqual([]);
  });

  it("handles a single cell", () => {
    expect(mergeBackgroundRuns([5])).toEqual([{ startX: 0, count: 1, bg: 5 }]);
  });

  // Finding #6c: the renderer now passes resolved CSS colour *strings*
  // (after reverse video is resolved against concrete theme colours), not
  // raw packed colour numbers -- the function must work identically either
  // way, since it only ever compares values with `===`.
  it("works over resolved colour strings just like packed colour numbers", () => {
    expect(mergeBackgroundRuns(["#1f1f1f", "#1f1f1f", "#cccccc"])).toEqual([
      { startX: 0, count: 2, bg: "#1f1f1f" },
      { startX: 2, count: 1, bg: "#cccccc" },
    ]);
  });
});
