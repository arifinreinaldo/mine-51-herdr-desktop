// Double-click word selection bounds (terminal-parity spec P1 #9), ported
// from herdr's TUI client's own `app::actions::word_bounds_at_column`
// (`src/app/actions.rs:1035-1318`) -- not invented. Finds the terminal
// display-column bounds of the token under a clicked column: URLs and
// quoted paths (containing a `/`) are preferred whole, punctuation/space
// otherwise delimits a plain token, and a handful of leading/trailing
// "wrapper" characters (brackets, quotes, trailing punctuation) are trimmed
// off the token's edges.
//
// One acknowledged simplification (`textCells`' `codePointWidth`): herdr's
// own cell-mapping uses `ghostty::unicode_codepoint_width`, a full Unicode
// East-Asian-width table. This port uses a smaller, common-range
// approximation (CJK/Hangul/fullwidth blocks + emoji, zero-width combining
// marks) -- exactly right for plain ASCII/Latin text (the overwhelming
// majority of shell output), and close enough for wide/zero-width
// characters that a column may be off by one in rarer scripts this table
// doesn't cover. `pane.selection.read`'s own row text remains the
// authoritative copy source regardless (only the *bounds* are computed
// client-side).

interface TextCell {
  ch: string;
  startCol: number;
  endCol: number;
}

interface CellSpan {
  start: number;
  end: number;
}

function spanContains(span: CellSpan, idx: number): boolean {
  return idx >= span.start && idx <= span.end;
}

function spanColumns(span: CellSpan, cells: readonly TextCell[]): [number, number] {
  return [cells[span.start].startCol, cells[span.end].endCol];
}

/** Common-range approximation of `ghostty::unicode_codepoint_width` -- see
 * this module's header comment. */
function codePointWidth(cp: number): number {
  if (cp === 0) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0; // combining/ZWJ/variation selectors
  const isWide =
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || // CJK radicals .. Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compat forms / small forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji/symbol blocks
    (cp >= 0x20000 && cp <= 0x3fffd); // CJK extension planes
  return isWide ? 2 : 1;
}

function textCells(row: string): TextCell[] {
  const cells: TextCell[] = [];
  let nextCol = 0;
  for (const ch of row) {
    const width = codePointWidth(ch.codePointAt(0) ?? 0);
    const startCol = width === 0 ? Math.max(0, nextCol - 1) : nextCol;
    if (width > 0) nextCol += width;
    cells.push({ ch, startCol, endCol: Math.max(0, nextCol - 1) });
  }
  return cells;
}

function cellIndexAtColumn(cells: readonly TextCell[], col: number): number | null {
  const index = cells.findIndex((cell) => cell.startCol <= col && col <= cell.endCol);
  return index === -1 ? null : index;
}

const WORD_SEPARATORS = new Set([
  "|",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ";",
  "!",
  "（",
  "）",
  "：",
  "、",
  "。",
  "，",
]);

function isWordSeparator(ch: string): boolean {
  return /\s/.test(ch) || WORD_SEPARATORS.has(ch);
}

function startsWithChars(cells: readonly TextCell[], prefix: string): boolean {
  return Array.from(prefix).every((expected, i) => cells[i]?.ch === expected);
}

function trailingUrlCloserIsBalanced(cells: readonly TextCell[], start: number, end: number, open: string, close: string): boolean {
  let balance = 0;
  for (let i = start; i < end; i++) {
    if (cells[i].ch === open) balance++;
    else if (cells[i].ch === close) balance--;
  }
  return balance > 0;
}

function shouldTrimTrailingUrlCell(cells: readonly TextCell[], start: number, end: number): boolean {
  switch (cells[end].ch) {
    case '"':
    case "'":
    case "`":
    case ".":
    case ",":
    case ";":
    case ":":
    case "!":
    case "?":
      return true;
    case ")":
      return !trailingUrlCloserIsBalanced(cells, start, end, "(", ")");
    case "]":
      return !trailingUrlCloserIsBalanced(cells, start, end, "[", "]");
    case "}":
      return !trailingUrlCloserIsBalanced(cells, start, end, "{", "}");
    default:
      return false;
  }
}

function trimUrlEdges(cells: readonly TextCell[], span: CellSpan): CellSpan | null {
  const start = span.start;
  let end = span.end;
  while (start <= end && shouldTrimTrailingUrlCell(cells, start, end)) {
    if (end === 0) return null;
    end -= 1;
  }
  return start <= end ? { start, end } : null;
}

function urlSpanAtColumn(cells: readonly TextCell[], clickedIdx: number): CellSpan | null {
  let start = 0;
  while (start < cells.length) {
    if (startsWithChars(cells.slice(start), "http://") || startsWithChars(cells.slice(start), "https://")) {
      let end = start;
      while (end + 1 < cells.length && !/\s/.test(cells[end + 1].ch)) end += 1;
      if (clickedIdx >= start && clickedIdx <= end) {
        const span = trimUrlEdges(cells, { start, end });
        return span && spanContains(span, clickedIdx) ? span : null;
      }
      start = end + 1;
    } else {
      start += 1;
    }
  }
  return null;
}

function isEscaped(cells: readonly TextCell[], idx: number): boolean {
  let slashes = 0;
  let cursor = idx;
  while (cursor > 0 && cells[cursor - 1].ch === "\\") {
    slashes += 1;
    cursor -= 1;
  }
  return slashes % 2 === 1;
}

function quotedPathSpanAtColumn(cells: readonly TextCell[], clickedIdx: number): CellSpan | null {
  const clicked = cells[clickedIdx]?.ch;
  if (clicked === '"' || clicked === "'" || clicked === "`") return null;

  for (const quote of ['"', "'", "`"]) {
    let start: number | null = null;
    for (let idx = 0; idx < cells.length; idx++) {
      const ch = cells[idx].ch;
      if (ch !== quote || isEscaped(cells, idx)) continue;
      if (start !== null) {
        const open = start;
        if (clickedIdx > open && clickedIdx < idx && cells.slice(open + 1, idx).some((c) => c.ch === "/")) {
          return { start: open + 1, end: idx - 1 };
        }
        start = null;
      } else {
        start = idx;
      }
    }
  }
  return null;
}

function isLeadingTokenWrapper(ch: string): boolean {
  return ch === "(" || ch === "[" || ch === "{" || ch === "<" || ch === '"' || ch === "'" || ch === "`";
}

function isTrailingTokenWrapper(ch: string): boolean {
  return (
    ch === ")" ||
    ch === "]" ||
    ch === "}" ||
    ch === ">" ||
    ch === '"' ||
    ch === "'" ||
    ch === "`" ||
    ch === "." ||
    ch === "," ||
    ch === ";" ||
    ch === ":" ||
    ch === "!" ||
    ch === "?"
  );
}

function trimTokenEdges(cells: readonly TextCell[], span: CellSpan): CellSpan | null {
  let start = span.start;
  let end = span.end;
  while (start <= end && isLeadingTokenWrapper(cells[start].ch)) start += 1;
  if (start < end && cells[end].ch === "$" && isTrailingTokenWrapper(cells[end - 1].ch)) end -= 1;
  while (start <= end && isTrailingTokenWrapper(cells[end].ch)) {
    if (end === 0) return null;
    end -= 1;
  }
  return start <= end ? { start, end } : null;
}

function tokenSpanAtColumn(cells: readonly TextCell[], clickedIdx: number): CellSpan | null {
  if (isWordSeparator(cells[clickedIdx].ch)) return null;

  let start = clickedIdx;
  while (start > 0 && !isWordSeparator(cells[start - 1].ch)) start -= 1;

  let end = clickedIdx;
  while (end + 1 < cells.length && !isWordSeparator(cells[end + 1].ch)) end += 1;

  const trimmed = trimTokenEdges(cells, { start, end });
  return trimmed && spanContains(trimmed, clickedIdx) ? trimmed : null;
}

/**
 * Finds the terminal display-column `[start, end]` bounds (inclusive) of
 * the token under `col` in `row`, or `null` when `col` is past the row's
 * last cell. Mirrors `app::actions::word_bounds_at_column` exactly: URL and
 * quoted-path spans are preferred whole, a plain separator-delimited token
 * otherwise.
 */
export function wordBoundsAtColumn(row: string, col: number): [number, number] | null {
  const cells = textCells(row);
  const clickedIdx = cellIndexAtColumn(cells, col);
  if (clickedIdx === null) return null;

  const span = urlSpanAtColumn(cells, clickedIdx) ?? quotedPathSpanAtColumn(cells, clickedIdx) ?? tokenSpanAtColumn(cells, clickedIdx);
  return span ? spanColumns(span, cells) : null;
}
