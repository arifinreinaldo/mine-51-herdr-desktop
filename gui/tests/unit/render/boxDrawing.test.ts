import { describe, expect, it } from "vitest";
import { blockDescriptor, boxLineDescriptor, classifyGlyph } from "../../../src/render/boxDrawing";

describe("classifyGlyph", () => {
  it("classifies box-drawing range U+2500-257F", () => {
    expect(classifyGlyph(0x2500)).toBe("box-line");
    expect(classifyGlyph(0x257f)).toBe("box-line");
  });

  it("classifies block range U+2580-259F", () => {
    expect(classifyGlyph(0x2580)).toBe("block");
    expect(classifyGlyph(0x259f)).toBe("block");
  });

  it("classifies an ordinary letter as text", () => {
    expect(classifyGlyph("A".codePointAt(0)!)).toBe("text");
  });

  it("classifies just outside the ranges as text", () => {
    expect(classifyGlyph(0x24ff)).toBe("text");
    expect(classifyGlyph(0x25a0)).toBe("text");
  });
});

describe("boxLineDescriptor", () => {
  it("light horizontal connects left+right only", () => {
    expect(boxLineDescriptor(0x2500)).toEqual({
      up: false,
      down: false,
      left: true,
      right: true,
      heavy: false,
    });
  });

  it("heavy vertical connects up+down and is heavy", () => {
    expect(boxLineDescriptor(0x2503)).toEqual({
      up: true,
      down: true,
      left: false,
      right: false,
      heavy: true,
    });
  });

  it("a light down-right corner connects down+right", () => {
    expect(boxLineDescriptor(0x250c)).toEqual({
      up: false,
      down: true,
      left: false,
      right: true,
      heavy: false,
    });
  });

  it("the cross connects all four sides", () => {
    expect(boxLineDescriptor(0x253c)?.up).toBe(true);
    expect(boxLineDescriptor(0x253c)?.down).toBe(true);
    expect(boxLineDescriptor(0x253c)?.left).toBe(true);
    expect(boxLineDescriptor(0x253c)?.right).toBe(true);
  });

  it("a rounded corner falls back to its square equivalent", () => {
    expect(boxLineDescriptor(0x256d)).toEqual(boxLineDescriptor(0x250c));
  });

  it("returns undefined for a non-box-line codepoint", () => {
    expect(boxLineDescriptor(0x41)).toBeUndefined();
  });
});

describe("blockDescriptor", () => {
  it("the full block fills the whole cell", () => {
    expect(blockDescriptor(0x2588)).toEqual({ rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
  });

  it("lower half block fills the bottom half", () => {
    expect(blockDescriptor(0x2584)?.rects[0]).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it("shade blocks fill the whole cell at reduced alpha", () => {
    expect(blockDescriptor(0x2591)?.alpha).toBe(0.25);
    expect(blockDescriptor(0x2592)?.alpha).toBe(0.5);
    expect(blockDescriptor(0x2593)?.alpha).toBe(0.75);
  });

  it("a quadrant combination glyph covers exactly its named quadrants", () => {
    // U+259B: upper-left + upper-right + lower-left
    const rects = blockDescriptor(0x259b)?.rects;
    expect(rects).toHaveLength(3);
    expect(rects).toContainEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(rects).toContainEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
    expect(rects).toContainEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
  });

  it("returns undefined for a non-block codepoint", () => {
    expect(blockDescriptor(0x41)).toBeUndefined();
  });
});
