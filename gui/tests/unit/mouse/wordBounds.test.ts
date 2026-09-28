import { describe, expect, it } from "vitest";
import { wordBoundsAtColumn } from "../../../src/mouse/wordBounds";

describe("wordBoundsAtColumn: plain tokens", () => {
  it("selects a plain word by clicking anywhere inside it", () => {
    const row = "hello world";
    expect(wordBoundsAtColumn(row, 0)).toEqual([0, 4]);
    expect(wordBoundsAtColumn(row, 2)).toEqual([0, 4]);
    expect(wordBoundsAtColumn(row, 4)).toEqual([0, 4]);
    expect(wordBoundsAtColumn(row, 6)).toEqual([6, 10]);
  });

  it("returns null when the column lands on a separator/whitespace", () => {
    expect(wordBoundsAtColumn("hello world", 5)).toBeNull();
  });

  it("returns null past the end of the row", () => {
    expect(wordBoundsAtColumn("hi", 50)).toBeNull();
  });

  it("trims trailing punctuation from a plain token", () => {
    // "word." -> "word" (trailing '.' is a trailing-token-wrapper).
    expect(wordBoundsAtColumn("word.", 0)).toEqual([0, 3]);
  });

  it("trims a leading/trailing bracket pair from a plain token", () => {
    expect(wordBoundsAtColumn("(word)", 1)).toEqual([1, 4]);
  });
});

describe("wordBoundsAtColumn: URLs", () => {
  it("selects a whole http URL, including punctuation a plain token would stop at", () => {
    const row = "see https://example.com/a-b_c?x=1&y=2 now";
    const bounds = wordBoundsAtColumn(row, 10)!;
    const selected = Array.from(row).slice(bounds[0], bounds[1] + 1).join("");
    expect(selected).toBe("https://example.com/a-b_c?x=1&y=2");
  });

  it("trims a trailing sentence-ending period off a URL, but keeps balanced parens", () => {
    const row = "go to https://example.com/path(1).";
    const bounds = wordBoundsAtColumn(row, 10)!;
    const selected = Array.from(row).slice(bounds[0], bounds[1] + 1).join("");
    expect(selected).toBe("https://example.com/path(1)");
  });
});

describe("wordBoundsAtColumn: quoted paths", () => {
  it("selects the contents of a quoted path containing a slash", () => {
    const row = 'open "src/main.ts" now';
    // `"src/main.ts"` -> inner span is columns 6..17.
    const bounds = wordBoundsAtColumn(row, 8)!;
    const selected = Array.from(row).slice(bounds[0], bounds[1] + 1).join("");
    expect(selected).toBe("src/main.ts");
  });

  it("does not treat a quoted string with no slash as a path (falls back to a plain token)", () => {
    const row = 'echo "hello"';
    const bounds = wordBoundsAtColumn(row, 7)!;
    const selected = Array.from(row).slice(bounds[0], bounds[1] + 1).join("");
    expect(selected).toBe("hello");
  });
});
