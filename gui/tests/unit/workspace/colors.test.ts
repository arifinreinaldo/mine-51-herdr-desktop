import { describe, expect, it } from "vitest";
import { assignWorkspaceColors, type WorkspaceColorAssignment } from "../../../src/workspace/colors";

describe("assignWorkspaceColors", () => {
  it("gives a brand-new workspace the lowest free index", () => {
    const existing: WorkspaceColorAssignment = { a: 2, b: 0 };
    const next = assignWorkspaceColors(["a", "b", "c"], existing);
    expect(next.c).toBe(1);
  });

  it("is stable across repeated calls with the same live set", () => {
    const existing: WorkspaceColorAssignment = { a: 3 };
    const first = assignWorkspaceColors(["a", "b"], existing);
    const second = assignWorkspaceColors(["a", "b"], first);
    expect(second).toEqual(first);
  });

  it("prunes ids that are no longer live", () => {
    const existing: WorkspaceColorAssignment = { a: 0, b: 1, gone: 5 };
    const next = assignWorkspaceColors(["a", "b"], existing);
    expect(next).toEqual({ a: 0, b: 1 });
    expect(next.gone).toBeUndefined();
  });

  it("a manual override persists like any other assignment", () => {
    // The user right-clicked "a" and picked swatch 7, even though 0/1 were
    // free -- the override must not be overwritten by a "lowest free" pass.
    const existing: WorkspaceColorAssignment = { a: 7 };
    const next = assignWorkspaceColors(["a", "b"], existing);
    expect(next.a).toBe(7);
    expect(next.b).toBe(0);
  });

  it("cycles by count once all 10 slots are in use", () => {
    const existing: Record<string, number> = {};
    for (let i = 0; i < 10; i++) existing[`ws-${i}`] = i;
    const liveIds = [...Array(10).keys()].map((i) => `ws-${i}`).concat(["ws-10", "ws-11"]);
    const next = assignWorkspaceColors(liveIds, existing);
    expect(next["ws-10"]).toBe(0);
    expect(next["ws-11"]).toBe(1);
  });

  it("assigns indices 0..N-1 for the first N (<=10) brand-new workspaces in order", () => {
    const next = assignWorkspaceColors(["a", "b", "c"], {});
    expect(next).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("an empty live set produces an empty assignment", () => {
    expect(assignWorkspaceColors([], { a: 0 })).toEqual({});
  });
});
