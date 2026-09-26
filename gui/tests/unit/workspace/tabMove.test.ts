import { describe, expect, it } from "vitest";
import {
  canMoveLeft,
  canMoveRight,
  dragDropInsertIndex,
  moveLeftInsertIndex,
  moveRightInsertIndex,
  optimisticTabOrderAfterMove,
} from "../../../src/workspace/tabMove";

describe("moveLeftInsertIndex / moveRightInsertIndex", () => {
  it("move left is i-1", () => {
    expect(moveLeftInsertIndex(3)).toBe(2);
  });

  it("move right is i+2", () => {
    expect(moveRightInsertIndex(3)).toBe(5);
  });

  // Worked example from spec §6, 5 tabs [A,B,C,D,E], moving C (index 2):
  // Move Left -> insert_index 1 (before B, i.e. swap with B: [A,C,B,D,E]).
  // Move Right -> insert_index 4 (before E post-removal, i.e. [A,B,D,C,E]).
  it("matches the spec's pre-removal insertion semantics for a middle tab", () => {
    expect(moveLeftInsertIndex(2)).toBe(1);
    expect(moveRightInsertIndex(2)).toBe(4);
  });
});

describe("canMoveLeft / canMoveRight", () => {
  it("cannot move left from index 0", () => {
    expect(canMoveLeft(0)).toBe(false);
    expect(canMoveLeft(1)).toBe(true);
  });

  it("cannot move right from the last index", () => {
    expect(canMoveRight(4, 5)).toBe(false);
    expect(canMoveRight(3, 5)).toBe(true);
  });
});

describe("dragDropInsertIndex", () => {
  it("is the identity of the caret slot", () => {
    expect(dragDropInsertIndex(0)).toBe(0);
    expect(dragDropInsertIndex(5)).toBe(5);
  });
});

// Finding #11 "Tab drag: optimistic reorder + snap back on error".
describe("optimisticTabOrderAfterMove", () => {
  it("moves the source forward, before the tab now at insertIndex", () => {
    // [A,B,C,D], move A (index 0) to insert_index 3 ("before D" pre-removal).
    expect(optimisticTabOrderAfterMove(["A", "B", "C", "D"], "A", 3)).toEqual(["B", "C", "A", "D"]);
  });

  it("moves the source backward, before the tab now at insertIndex", () => {
    // [A,B,C,D], move D (index 3) to insert_index 0 ("before A" pre-removal).
    expect(optimisticTabOrderAfterMove(["A", "B", "C", "D"], "D", 0)).toEqual(["D", "A", "B", "C"]);
  });

  it("inserting a tab before itself is a no-op", () => {
    expect(optimisticTabOrderAfterMove(["A", "B", "C", "D"], "B", 1)).toEqual(["A", "B", "C", "D"]);
  });

  it("matches moveLeftInsertIndex/moveRightInsertIndex's own worked example", () => {
    // [A,B,C,D,E], moving C (index 2): left -> [A,C,B,D,E], right -> [A,B,D,C,E].
    const tabs = ["A", "B", "C", "D", "E"];
    expect(optimisticTabOrderAfterMove(tabs, "C", moveLeftInsertIndex(2))).toEqual(["A", "C", "B", "D", "E"]);
    expect(optimisticTabOrderAfterMove(tabs, "C", moveRightInsertIndex(2))).toEqual(["A", "B", "D", "C", "E"]);
  });

  it("inserting at len (the end) appends the source last", () => {
    expect(optimisticTabOrderAfterMove(["A", "B", "C"], "A", 3)).toEqual(["B", "C", "A"]);
  });

  it("clamps an out-of-range insertIndex instead of throwing", () => {
    expect(optimisticTabOrderAfterMove(["A", "B", "C"], "A", 99)).toEqual(["B", "C", "A"]);
    expect(optimisticTabOrderAfterMove(["A", "B", "C"], "C", -5)).toEqual(["C", "A", "B"]);
  });

  it("returns a copy, unchanged, when the tab id is not present", () => {
    const tabs = ["A", "B", "C"];
    const result = optimisticTabOrderAfterMove(tabs, "Z", 1);
    expect(result).toEqual(tabs);
    expect(result).not.toBe(tabs);
  });
});
