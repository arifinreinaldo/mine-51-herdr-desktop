// @vitest-environment jsdom
//
// jsdom, not the default "node" environment: `dragDropFiles.ts` imports
// `appApi.ts`/`appDom.ts`'s top-level `document.getElementById(...)`
// lookups.

import { describe, expect, it } from "vitest";
import { pathsToPasteText, quotePathForPowerShell } from "../../src/dragDropFiles";

describe("quotePathForPowerShell", () => {
  it("wraps a plain path in single quotes", () => {
    expect(quotePathForPowerShell("C:\\Users\\me\\file.txt")).toBe("'C:\\Users\\me\\file.txt'");
  });

  it("doubles an embedded single quote", () => {
    expect(quotePathForPowerShell("C:\\it's a folder\\file.txt")).toBe("'C:\\it''s a folder\\file.txt'");
  });

  it("leaves $ and backticks untouched (not special inside single quotes)", () => {
    expect(quotePathForPowerShell("C:\\$env\\`backtick")).toBe("'C:\\$env\\`backtick'");
  });

  it("quotes a path containing spaces", () => {
    expect(quotePathForPowerShell("C:\\My Documents\\file.txt")).toBe("'C:\\My Documents\\file.txt'");
  });
});

describe("pathsToPasteText", () => {
  it("joins multiple quoted paths with a single space", () => {
    expect(pathsToPasteText(["a.txt", "b.txt"])).toBe("'a.txt' 'b.txt'");
  });

  it("is empty for no paths", () => {
    expect(pathsToPasteText([])).toBe("");
  });
});
