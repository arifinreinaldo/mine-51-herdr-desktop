import { describe, expect, it } from "vitest";
import { isBlackFrame, screenshotFileName } from "../../src/android/screenshotFormat";

describe("screenshotFileName", () => {
  it("pads single digits", () => {
    expect(screenshotFileName(new Date(2026, 0, 5, 3, 4, 5))).toBe("screenshot-20260105-030405.png");
  });

  it("keeps two-digit parts", () => {
    expect(screenshotFileName(new Date(2026, 8, 30, 14, 32, 7))).toBe("screenshot-20260930-143207.png");
  });
});

describe("isBlackFrame", () => {
  const frame = (r: number, g: number, b: number, a = 255, pixels = 4) =>
    new Uint8ClampedArray(Array.from({ length: pixels }, () => [r, g, b, a]).flat());

  it("is true for all-zero pixels", () => {
    expect(isBlackFrame(frame(0, 0, 0))).toBe(true);
  });

  it("is false for mid-grey", () => {
    expect(isBlackFrame(frame(128, 128, 128))).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(isBlackFrame(new Uint8ClampedArray(0))).toBe(false);
  });

  it("ignores alpha", () => {
    expect(isBlackFrame(frame(0, 0, 0, 255))).toBe(true);
    expect(isBlackFrame(frame(0, 0, 0, 0))).toBe(true);
    expect(isBlackFrame(frame(200, 200, 200, 0))).toBe(false);
  });

  it("respects the threshold", () => {
    expect(isBlackFrame(frame(5, 5, 5))).toBe(false);
    expect(isBlackFrame(frame(5, 5, 5), 6)).toBe(true);
    expect(isBlackFrame(frame(3, 3, 3))).toBe(false); // mean 3 is not below 3
  });
});
