import { describe, expect, it } from "vitest";
import { fuzzyMatch, makeRanker, rankPaths } from "../../../src/files/fuzzy";

describe("fuzzyMatch", () => {
  it("matches BaCo against the file name with boundary positions", () => {
    expect(fuzzyMatch("BaCo", "app/Http/BankController.php")?.positions).toEqual([0, 1, 4, 5]);
  });

  it("returns null when there is no subsequence", () => {
    expect(fuzzyMatch("xyz", "app/Http/BankController.php")).toBeNull();
  });

  it("does not match folder names", () => {
    expect(fuzzyMatch("Http", "app/Http/BankController.php")).toBeNull();
  });

  it("prefers camel humps", () => {
    expect(fuzzyMatch("BC", "app/Http/BankController.php")?.positions).toEqual([0, 4]);
  });

  it("splits a spaced query into words that each match the name", () => {
    const m = fuzzyMatch("rad page", "lib/rad_pagefield.dart");
    expect(m).not.toBeNull();
    expect(m?.positions).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });

  it("finds rad_pagefield from rad page, with the words in either order", () => {
    expect(fuzzyMatch("page rad", "lib/rad_pagefield.dart")).not.toBeNull();
    expect(fuzzyMatch("rad_page", "lib/rad_pagefield.dart")).not.toBeNull();
  });

  it("lets a folder word narrow a multi-word query", () => {
    expect(fuzzyMatch("model rad", "lib/model/rad_pagefield.dart")).not.toBeNull();
    expect(fuzzyMatch("view rad", "lib/model/rad_pagefield.dart")).toBeNull();
  });

  it("needs one word to hit the file name", () => {
    expect(fuzzyMatch("lib model", "lib/model/rad_pagefield.dart")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(fuzzyMatch("", "a.ts")).toBeNull();
    expect(fuzzyMatch("   ", "a.ts")).toBeNull();
  });
});

describe("rankPaths", () => {
  it("ranks prefix and boundary hits above scattered ones", () => {
    const out = rankPaths("main", ["src/domain.ts", "src/main.ts", "main.rs"]);
    expect(out.map((r) => r.path)).toEqual(["main.rs", "src/main.ts", "src/domain.ts"]);
  });

  it("breaks a score tie by shorter path", () => {
    const out = rankPaths("util", ["a/b/c/util.ts", "util.ts"]);
    expect(out[0].path).toBe("util.ts");
  });

  it("caps the results at 50 by default and at limit when given", () => {
    const paths = Array.from({ length: 60 }, (_, i) => `d/file${i}.ts`);
    expect(rankPaths("file", paths)).toHaveLength(50);
    expect(rankPaths("file", paths, 5)).toHaveLength(5);
  });

  it("ranks a name-only hit above a folder-word hit", () => {
    const out = rankPaths("page rad", ["model/rad_pagefield.dart", "rad/page_x.dart"]);
    expect(out[0].path).toBe("model/rad_pagefield.dart");
  });

  it("returns [] for an empty query", () => {
    expect(rankPaths("", ["a.ts"])).toEqual([]);
  });

  it("finds apSoCo in appSourceControl.ts, shortest path winning the tie", () => {
    const out = rankPaths("apSoCo", [
      "gui/docs/appendix-sources-and-colors.md",
      "gui/src/ui/sourceControl.ts",
      "gui/src/appStatusBar.ts",
      "gui/src/appSourceControl.ts",
    ]);
    expect(out[0].path).toBe("gui/src/appSourceControl.ts");
  });
});

describe("makeRanker", () => {
  const paths = [
    "gui/src/appSourceControl.ts", "gui/src/appStatusBar.ts", "gui/src/ui/sourceControl.ts",
    "model/rad_pagefield.dart", "rad/page_x.dart", "rad/page_y.dart", "a/b/c/util.ts", "util.ts",
    "src/main.ts", "src/domain.ts", "main.rs", "docs/Main Notes.md",
  ];
  const many = Array.from({ length: 120 }, (_, i) => `d${i % 7}/file${i}.ts`);
  // Typing, deleting, replacing and token-count changes, each checked against a fresh rankPaths.
  const sessions = [
    ["a", "ap", "apS", "apSo", "apSoCo"],
    ["m", "ma", "mai", "main", "mai", "ma", "x", "xy"],
    ["rad", "rad ", "rad p", "rad pa", "rad page", "rad pag", "rad_page", "rad page x"],
    ["page", "page rad", "page ra", "page", "pag"],
    ["u", "ut", "util", "util.", "util.t", "util.ts"],
    ["f", "fi", "file", "file1", "file12", "file1", "", "file"],
    ["rad_", "rad_p", "rad", "rad-page", "rad/page"],
  ];
  for (const [i, queries] of sessions.entries()) {
    for (const [name, list] of [["small", paths], ["many", many]] as const) {
      for (const limit of [50, 5, 1, 0]) {
        it(`matches rankPaths: session ${i}, ${name}, limit ${limit}`, () => {
          const rank = makeRanker(list, limit);
          for (const q of queries) expect(rank(q)).toEqual(rankPaths(q, list, limit));
        });
      }
    }
  }

  it("does not reuse survivors when the token count changes", () => {
    const rank = makeRanker(["rad/page_x.dart", "model/rad_pagefield.dart"]);
    rank("rad");
    expect(rank("rad page")).toEqual(rankPaths("rad page", ["rad/page_x.dart", "model/rad_pagefield.dart"]));
    expect(rank("rad page").length).toBeGreaterThan(0);
  });

  it("keeps the input order for fully tied duplicates", () => {
    const dup = ["a/x.ts", "a/x.ts", "b/x.ts"];
    expect(makeRanker(dup, 2)("x")).toEqual(rankPaths("x", dup, 2));
  });
});
