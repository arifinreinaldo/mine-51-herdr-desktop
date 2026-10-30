// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `links.ts` imports `appApi.ts`,
// which imports `appDom.ts`'s top-level `document.getElementById(...)`
// lookups -- needed even though this file only exercises the pure
// `hoverCallAllowed` predicate below.

import { describe, expect, it } from "vitest";
import { hoverCallAllowed, isUnsupportedMethod, pathAtColumn, pathAtWrappedRows, wrapsOntoNextRow } from "../../src/links";

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

describe("pathAtColumn edge cases", () => {
  it("picks the path under the column when a row holds two", () => {
    const row = "C:\\a\\one.csv and D:\\b\\two.csv";
    expect(pathAtColumn(row, 3)?.path).toBe("C:\\a\\one.csv");
    expect(pathAtColumn(row, 20)?.path).toBe("D:\\b\\two.csv");
    expect(pathAtColumn(row, 14)).toBeNull();
  });

  it("ignores a drive-like sequence inside a word", () => {
    expect(pathAtColumn("abC:\\x\\y.txt", 6)).toBeNull();
  });
});

describe("pathAtWrappedRows", () => {
  // Layout measured in a 136-column pane (Claude Code's TUI): a long path breaks
  // after 135 columns and the next row is indented by 2.
  const WIDTH = 136;
  const PROMPT = "❯ ";
  const REAL =
    "C:\\Users\\Reinaldo\\AppData\\Local\\Temp\\claude\\C--Users-Reinaldo-AndroidStudioProjects-cloudpush-android\\39718f69-f26c-42f2-8cf3-09fdb96f66b2\\scratchpad\\mock\\glass-draft.png";
  const LONG = REAL.replace("mock", "mock\\" + "deeper-folder\\".repeat(8));
  const wrap = (text: string) => {
    const rows = [{ row: 10, text: text.slice(0, WIDTH - 1) }];
    for (let at = WIDTH - 1; at < text.length; at += WIDTH - 3) {
      rows.push({ row: 10 + rows.length, text: "  " + text.slice(at, at + WIDTH - 3) });
    }
    return rows;
  };

  it("wraps the real path over 2 rows like the terminal does", () => {
    const rows = wrap(PROMPT + REAL);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toHaveLength(135);
    expect(rows[1].text.startsWith("  ")).toBe(true);
  });

  it("finds the whole real path from a click on either row", () => {
    const rows = wrap(PROMPT + REAL);
    expect(pathAtWrappedRows(rows, 10, 40)?.path).toBe(REAL);
    expect(pathAtWrappedRows(rows, 11, 10)?.path).toBe(REAL);
  });

  it("underlines each row without the prompt or the indent", () => {
    const rows = wrap(PROMPT + REAL);
    const m = pathAtWrappedRows(rows, 11, 10)!;
    expect(m.regions).toEqual([
      { row: 10, start_col: PROMPT.length, end_col: 134 },
      { row: 11, start_col: 2, end_col: rows[1].text.length - 1 },
    ]);
  });

  it("works over 3+ rows and trims a trailing dot", () => {
    const rows = wrap(PROMPT + LONG + ".");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const { row, text } of rows.slice(1)) {
      expect(pathAtWrappedRows(rows, row, Math.min(5, text.length - 1))?.path, `row ${row}`).toBe(LONG);
    }
    const last = pathAtWrappedRows(rows, rows[rows.length - 1].row, 5)!.regions.at(-1)!;
    expect(last.end_col).toBe(rows[rows.length - 1].text.length - 2);
  });

  it("returns null for the prompt, the indent, a one-row path and an unknown row", () => {
    const rows = wrap(PROMPT + REAL);
    expect(pathAtWrappedRows(rows, 10, 0)).toBeNull();
    expect(pathAtWrappedRows(rows, 11, 1)).toBeNull();
    expect(pathAtWrappedRows([{ row: 3, text: "see C:\\a\\b.txt now" }], 3, 6)).toBeNull();
    expect(pathAtWrappedRows(rows, 99, 0)).toBeNull();
  });
});

describe("wrapsOntoNextRow", () => {
  it("is true for a row that reaches the pane edge, with 2 columns of slack", () => {
    expect(wrapsOntoNextRow("x".repeat(136), 136)).toBe(true);
    expect(wrapsOntoNextRow("x".repeat(135), 136)).toBe(true);
    expect(wrapsOntoNextRow("x".repeat(134), 136)).toBe(true);
  });

  it("is false for a row that stops short of the edge", () => {
    expect(wrapsOntoNextRow("x".repeat(133), 136)).toBe(false);
    expect(wrapsOntoNextRow("", 136)).toBe(false);
  });
});
