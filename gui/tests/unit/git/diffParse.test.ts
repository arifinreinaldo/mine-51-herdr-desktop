import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../../src/git/diffParse";

const MODIFY = [
  "diff --git a/a.txt b/a.txt",
  "index 1111111..2222222 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+TWO",
  " three",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("parses a modify hunk with old and new line numbers", () => {
    expect(parseUnifiedDiff(MODIFY + "\n")).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", text: " one", oldNo: 1, newNo: 1 },
      { kind: "del", text: "-two", oldNo: 2, newNo: null },
      { kind: "add", text: "+TWO", oldNo: null, newNo: 2 },
      { kind: "context", text: " three", oldNo: 3, newNo: 3 },
    ]);
  });

  it("parses a new file", () => {
    const text = [
      "diff --git a/n.txt b/n.txt",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/n.txt",
      "@@ -0,0 +1,3 @@",
      "+a",
      "+b",
      "+c",
      "",
    ].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows[0]).toEqual({ kind: "meta", text: "new file mode 100644" });
    expect(rows[1]).toEqual({ kind: "hunk", text: "@@ -0,0 +1,3 @@" });
    expect(rows.slice(2)).toEqual([
      { kind: "add", text: "+a", oldNo: null, newNo: 1 },
      { kind: "add", text: "+b", oldNo: null, newNo: 2 },
      { kind: "add", text: "+c", oldNo: null, newNo: 3 },
    ]);
  });

  it("parses a deleted file", () => {
    const text = [
      "diff --git a/d.txt b/d.txt",
      "deleted file mode 100644",
      "index 4444444..0000000",
      "--- a/d.txt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-x",
      "-y",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(text)).toEqual([
      { kind: "meta", text: "deleted file mode 100644" },
      { kind: "hunk", text: "@@ -1,2 +0,0 @@" },
      { kind: "del", text: "-x", oldNo: 1, newNo: null },
      { kind: "del", text: "-y", oldNo: 2, newNo: null },
    ]);
  });

  it("restarts the counters on each hunk", () => {
    const text = [
      "@@ -1,2 +1,2 @@",
      " a",
      "-b",
      "+B",
      "@@ -10,2 +10,3 @@",
      " j",
      "+k",
      " l",
    ].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows[1]).toMatchObject({ kind: "context", oldNo: 1, newNo: 1 });
    expect(rows[2]).toMatchObject({ kind: "del", oldNo: 2 });
    expect(rows[3]).toMatchObject({ kind: "add", newNo: 2 });
    expect(rows[4]).toEqual({ kind: "hunk", text: "@@ -10,2 +10,3 @@" });
    expect(rows[5]).toMatchObject({ kind: "context", oldNo: 10, newNo: 10 });
    expect(rows[6]).toMatchObject({ kind: "add", oldNo: null, newNo: 11 });
    expect(rows[7]).toMatchObject({ kind: "context", oldNo: 11, newNo: 12 });
  });

  it('keeps "\\ No newline at end of file" as meta without moving the counters', () => {
    const text = ["@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file", ""].join("\n");
    expect(parseUnifiedDiff(text)).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "del", text: "-a", oldNo: 1, newNo: null },
      { kind: "meta", text: "\\ No newline at end of file" },
      { kind: "add", text: "+b", oldNo: null, newNo: 1 },
      { kind: "meta", text: "\\ No newline at end of file" },
    ]);
  });

  it("treats a count-less hunk header as a count of 1", () => {
    expect(parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n")).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "del", text: "-a", oldNo: 1, newNo: null },
      { kind: "add", text: "+b", oldNo: null, newNo: 1 },
    ]);
  });

  it("strips a trailing \\r from CRLF input", () => {
    const lf = parseUnifiedDiff(MODIFY + "\n");
    const crlf = parseUnifiedDiff(MODIFY.replace(/\n/g, "\r\n") + "\r\n");
    expect(crlf.some((row) => row.text.endsWith("\r"))).toBe(false);
    expect(crlf.map((row) => row.kind)).toEqual(lf.map((row) => row.kind));
  });

  it("returns [] for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it('keeps a deleted line that starts with "--" inside a hunk as del', () => {
    // The file line `-- x` is deleted, so git prints `--- x`.
    const rows = parseUnifiedDiff("@@ -1,2 +1 @@\n--- x\n y\n");
    expect(rows[1]).toEqual({ kind: "del", text: "--- x", oldNo: 1, newNo: null });
    expect(rows[2]).toMatchObject({ kind: "context", oldNo: 2, newNo: 1 });
  });
});
