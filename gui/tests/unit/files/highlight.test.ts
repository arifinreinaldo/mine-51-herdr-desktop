import { describe, expect, it } from "vitest";
import { languageFor, tokenizeLine, type LineState, type Token } from "../../../src/files/highlight";

function lex(file: string, line: string, state: LineState = null) {
  return tokenizeLine(line, languageFor(file), state);
}
const kinds = (tokens: Token[], kind: Token["kind"]) => tokens.filter((t) => t.kind === kind).map((t) => t.text);

describe("languageFor", () => {
  it("returns null for an unknown extension and one plain token", () => {
    expect(languageFor("x.unknown")).toBeNull();
    expect(languageFor("Makefile")).toBeNull();
    expect(lex("x.unknown", "function a").tokens).toEqual([{ kind: "plain", text: "function a" }]);
  });

  it("matches the extension case-insensitively", () => {
    expect(languageFor("A.KT")).toBe(languageFor("b.kts"));
    expect(languageFor("A.KT")).not.toBeNull();
  });
});

describe("php", () => {
  it("marks keywords", () => {
    expect(kinds(lex("a.php", "function f() { return 1; }").tokens, "keyword")).toEqual(["function", "return"]);
  });
  it("keeps an escaped quote inside one string", () => {
    expect(kinds(lex("a.php", 'echo "a\\"b";').tokens, "string")).toEqual(['"a\\"b"']);
  });
  it("marks numbers and line comments", () => {
    expect(kinds(lex("a.php", "$x = 42;").tokens, "number")).toEqual(["42"]);
    expect(lex("a.php", "// c").tokens).toEqual([{ kind: "comment", text: "// c" }]);
    expect(lex("a.php", "# c").tokens).toEqual([{ kind: "comment", text: "# c" }]);
  });
});

describe("dart", () => {
  it("carries a block comment into the next line", () => {
    const a = lex("a.dart", "/* open");
    expect(a.tokens).toEqual([{ kind: "comment", text: "/* open" }]);
    expect(a.state).toEqual({ kind: "comment", close: "*/" });
    const b = lex("a.dart", "still */ var y = 3;", a.state);
    expect(b.state).toBeNull();
    expect(b.tokens).toEqual([
      { kind: "comment", text: "still */" },
      { kind: "plain", text: " " },
      { kind: "keyword", text: "var" },
      { kind: "plain", text: " y = " },
      { kind: "number", text: "3" },
      { kind: "plain", text: ";" },
    ]);
  });
  it("carries a triple-quote string", () => {
    const a = lex("a.dart", "var s = '''abc");
    expect(a.state).toEqual({ kind: "string", close: "'''" });
    const b = lex("a.dart", "def''' + x", a.state);
    expect(b.state).toBeNull();
    expect(kinds(b.tokens, "string")).toEqual(["def'''"]);
  });
  it("does not carry a single-quote string", () => {
    expect(lex("a.dart", "var s = 'abc").state).toBeNull();
  });
});

describe("kotlin", () => {
  it("carries a triple-quote string", () => {
    const a = lex("a.kt", 'val s = """abc');
    expect(a.state).toEqual({ kind: "string", close: '"""' });
    expect(lex("a.kt", 'x"""', a.state).state).toBeNull();
  });
});

describe("ts", () => {
  it("carries a backtick string", () => {
    const a = lex("a.ts", "const s = `abc");
    expect(a.state).toEqual({ kind: "string", close: "`" });
    const b = lex("a.ts", "def` + 1", a.state);
    expect(b.state).toBeNull();
    expect(kinds(b.tokens, "number")).toEqual(["1"]);
  });
  it("marks a hex number", () => {
    expect(kinds(lex("a.ts", "const n = 0x1F;").tokens, "number")).toEqual(["0x1F"]);
  });
});

describe("sql", () => {
  it("marks keywords in any case", () => {
    expect(kinds(lex("a.sql", "SELECT a FROM t").tokens, "keyword")).toEqual(["SELECT", "FROM"]);
    expect(kinds(lex("a.sql", "select a from t").tokens, "keyword")).toEqual(["select", "from"]);
  });
  it("marks strings and comments", () => {
    expect(kinds(lex("a.sql", "where a = 'x'").tokens, "string")).toEqual(["'x'"]);
    expect(lex("a.sql", "-- c").tokens).toEqual([{ kind: "comment", text: "-- c" }]);
  });
});

describe("json", () => {
  it("marks true as a keyword", () => {
    expect(kinds(lex("a.json", '"a": true').tokens, "keyword")).toEqual(["true"]);
  });
  it("lexes -1.5e3 as plain minus and number 1.5e3", () => {
    expect(kinds(lex("a.json", "-1.5e3").tokens, "number")).toEqual(["1.5e3"]);
  });
  it("keeps an escaped quote inside one string", () => {
    expect(kinds(lex("a.json", '"q\\"x"').tokens, "string")).toEqual(['"q\\"x"']);
  });
});

describe("yaml", () => {
  it("marks comment, keyword and string", () => {
    expect(lex("a.yaml", "# c").tokens).toEqual([{ kind: "comment", text: "# c" }]);
    expect(kinds(lex("a.yml", "a: true").tokens, "keyword")).toEqual(["true"]);
    expect(kinds(lex("a.yml", 'a: "v"').tokens, "string")).toEqual(['"v"']);
  });
});

describe("markdown", () => {
  it("marks a heading line as one keyword token", () => {
    expect(lex("a.md", "# Title").tokens).toEqual([{ kind: "keyword", text: "# Title" }]);
  });
  it("carries the fence string state until the closing fence", () => {
    const open = lex("a.md", "```ts");
    expect(open.state).toEqual({ kind: "string", close: "```" });
    const mid = lex("a.md", "# not a heading", open.state);
    expect(mid.state).toEqual(open.state);
    expect(mid.tokens).toEqual([{ kind: "string", text: "# not a heading" }]);
    const close = lex("a.md", "```", mid.state);
    expect(close.state).toBeNull();
  });
  it("marks an HTML comment", () => {
    expect(lex("a.md", "<!-- c -->").tokens).toEqual([{ kind: "comment", text: "<!-- c -->" }]);
  });
});

describe("words", () => {
  it("does not split a word that ends in digits", () => {
    expect(lex("a.ts", "abc123").tokens).toEqual([{ kind: "plain", text: "abc123" }]);
  });
});
