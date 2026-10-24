import { describe, expect, it } from "vitest";
import { baseName, rowRange, tableSql } from "../../src/android/dbFormat";

describe("tableSql", () => {
  it("quotes a plain name", () => expect(tableSql("users")).toBe('SELECT * FROM "users"'));
  it("doubles embedded quotes", () => expect(tableSql('a"b')).toBe('SELECT * FROM "a""b"'));
  it("keeps a hostile name inside the identifier", () =>
    expect(tableSql('x"; DROP TABLE y; --')).toBe('SELECT * FROM "x""; DROP TABLE y; --"'));
});

describe("rowRange", () => {
  it("is No rows for an empty page", () => expect(rowRange(0, 0, false)).toBe("No rows"));
  it("counts the rows when one page holds them all", () => {
    expect(rowRange(0, 21, false)).toBe("21 rows");
    expect(rowRange(0, 1, false)).toBe("1 row");
  });
  it("is one-based and inclusive across pages", () => {
    expect(rowRange(0, 100, true)).toBe("Rows 1–100");
    expect(rowRange(100, 37, false)).toBe("Rows 101–137");
  });
});

describe("baseName", () => {
  it("keeps the last segment", () => expect(baseName("files/databases/a.sqlite")).toBe("a.sqlite"));
  it("keeps a bare name", () => expect(baseName("logdb.sqlite")).toBe("logdb.sqlite"));
});
