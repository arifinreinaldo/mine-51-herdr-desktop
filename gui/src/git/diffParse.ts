// Git MVP spec §5: a pure unified-diff parser for the diff view. It keeps each
// line's `+`, `-` or space prefix in `text` and numbers the hunk rows.

export type DiffLine =
  | { kind: "hunk"; text: string }
  | { kind: "context" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null }
  | { kind: "meta"; text: string };

// shortcut: combined conflict diffs (@@@) do not match the hunk regex, so they render as meta rows; parse them if conflict viewing matters.
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HEADER_PREFIXES = ["diff --git ", "index ", "--- ", "+++ "];

export function parseUnifiedDiff(text: string): DiffLine[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const out: DiffLine[] = [];
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;

  for (let line of lines) {
    if (line.endsWith("\r")) line = line.slice(0, -1);

    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      out.push({ kind: "hunk", text: line });
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      if (!HEADER_PREFIXES.some((p) => line.startsWith(p))) out.push({ kind: "meta", text: line });
      continue;
    }

    switch (line[0]) {
      case "-":
        out.push({ kind: "del", text: line, oldNo: oldNo++, newNo: null });
        break;
      case "+":
        out.push({ kind: "add", text: line, oldNo: null, newNo: newNo++ });
        break;
      case " ":
      case undefined: // an empty line is context whose leading space was stripped
        out.push({ kind: "context", text: line, oldNo: oldNo++, newNo: newNo++ });
        break;
      default: // "\ No newline at end of file" and anything unknown
        out.push({ kind: "meta", text: line });
    }
  }
  return out;
}
