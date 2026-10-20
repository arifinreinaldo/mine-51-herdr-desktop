// File viewer spec §8.4: table-driven, line-by-line tokenizer for the file viewer.
// Git P1 O2 (the diff view) reuses this module (D5).
// shortcut: lexical only; a PHP heredoc or regex literal can get wrong colours (spec §8.4).
export type TokenKind = "plain" | "keyword" | "string" | "number" | "comment";
export interface Token { kind: TokenKind; text: string }
/** What carries over to the next line: an open block comment or an open multi-line string. */
export type LineState = { kind: "comment" | "string"; close: string } | null;
export interface Language {
  keywords: ReadonlySet<string>;
  caseInsensitive?: boolean;
  lineComments: readonly string[];
  blockComment?: readonly [string, string];
  /** Longest delimiter first. */
  strings: readonly string[];
  /** The string delimiters that may span lines. */
  multiline: readonly string[];
  headings?: boolean;
}

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

const PHP_KEYWORDS = words(
  "abstract and array as break case catch class clone const continue declare default do echo else elseif empty enum extends false final finally fn for foreach function global if implements include include_once instanceof interface isset list match namespace new null or parent print private protected public readonly require require_once return self static switch throw trait true try unset use var while yield",
);
const DART_KEYWORDS = words(
  "abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield",
);
const KOTLIN_KEYWORDS = words(
  "abstract annotation as break by catch class companion const constructor continue data do else enum false final finally for fun get if import in init inline inner interface internal is lateinit null object open operator out override package private protected public return sealed set super suspend this throw true try typealias val var vararg when where while",
);
const TS_KEYWORDS = words(
  "abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let never new null number of private protected public readonly return satisfies set static string super switch this throw true try type typeof undefined unknown var void while yield",
);
const SQL_KEYWORDS = words(
  "select from where and or not insert into values update set delete create alter drop table index view join inner left right outer full cross on as group by order having limit offset union all distinct case when then else end null is in exists between like primary key foreign references default unique constraint begin commit rollback asc desc with returning true false",
);
const DATA_KEYWORDS = words("true false null");

const PHP: Language = { keywords: PHP_KEYWORDS, lineComments: ["//", "#"], blockComment: ["/*", "*/"], strings: ['"', "'"], multiline: ['"', "'"] };
const DART: Language = { keywords: DART_KEYWORDS, lineComments: ["//"], blockComment: ["/*", "*/"], strings: ["'''", '"""', "'", '"'], multiline: ["'''", '"""'] };
const KOTLIN: Language = { keywords: KOTLIN_KEYWORDS, lineComments: ["//"], blockComment: ["/*", "*/"], strings: ['"""', '"', "'"], multiline: ['"""'] };
const TS: Language = { keywords: TS_KEYWORDS, lineComments: ["//"], blockComment: ["/*", "*/"], strings: ["`", '"', "'"], multiline: ["`"] };
const SQL: Language = { keywords: SQL_KEYWORDS, caseInsensitive: true, lineComments: ["--"], blockComment: ["/*", "*/"], strings: ["'"], multiline: [] };
const JSON_LANG: Language = { keywords: DATA_KEYWORDS, lineComments: [], strings: ['"'], multiline: [] };
const YAML: Language = { keywords: DATA_KEYWORDS, lineComments: ["#"], strings: ['"', "'"], multiline: [] };
const MARKDOWN: Language = { keywords: new Set(), lineComments: [], blockComment: ["<!--", "-->"], strings: ["```", "`"], multiline: ["```"], headings: true };

const BY_EXTENSION: Record<string, Language> = {
  php: PHP,
  dart: DART,
  kt: KOTLIN,
  kts: KOTLIN,
  ts: TS, tsx: TS, js: TS, jsx: TS, mjs: TS, cjs: TS,
  sql: SQL,
  json: JSON_LANG,
  yaml: YAML, yml: YAML,
  md: MARKDOWN, markdown: MARKDOWN,
};

export function languageFor(fileName: string): Language | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

const NUMBER = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
const WORD = /[A-Za-z_$][\w$]*/y;
const HEADING = /^#{1,6}(\s|$)/;

/** Index just after `close` at or past `from`, skipping `\x` escape pairs; -1 when the line has no close. */
function scanString(line: string, from: number, close: string): number {
  for (let j = from; j < line.length; ) {
    if (line[j] === "\\") j += 2;
    else if (line.startsWith(close, j)) return j + close.length;
    else j++;
  }
  return -1;
}

export function tokenizeLine(line: string, lang: Language | null, state: LineState): { tokens: Token[]; state: LineState } {
  if (lang === null) return { tokens: [{ kind: "plain", text: line }], state: null };

  const out: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    if (text === "") return;
    const last = out[out.length - 1];
    if (kind === "plain" && last?.kind === "plain") last.text += text;
    else out.push({ kind, text });
  };
  let next: LineState = null;
  let i = 0;

  if (state !== null) {
    const end = state.kind === "comment"
      ? (() => { const k = line.indexOf(state.close); return k < 0 ? -1 : k + state.close.length; })()
      : scanString(line, 0, state.close);
    if (end < 0) {
      push(state.kind, line);
      return { tokens: out, state };
    }
    push(state.kind, line.slice(0, end));
    i = end;
  } else if (lang.headings && HEADING.test(line)) {
    return { tokens: [{ kind: "keyword", text: line }], state: null };
  }

  scan: while (i < line.length) {
    for (const prefix of lang.lineComments) {
      if (line.startsWith(prefix, i)) { push("comment", line.slice(i)); break scan; }
    }
    if (lang.blockComment && line.startsWith(lang.blockComment[0], i)) {
      const [open, close] = lang.blockComment;
      const k = line.indexOf(close, i + open.length);
      if (k < 0) { push("comment", line.slice(i)); next = { kind: "comment", close }; break scan; }
      push("comment", line.slice(i, k + close.length));
      i = k + close.length;
      continue;
    }
    for (const delim of lang.strings) {
      if (!line.startsWith(delim, i)) continue;
      const end = scanString(line, i + delim.length, delim);
      if (end < 0) {
        push("string", line.slice(i));
        if (lang.multiline.includes(delim)) next = { kind: "string", close: delim };
        break scan;
      }
      push("string", line.slice(i, end));
      i = end;
      continue scan;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(line);
    if (num) { push("number", num[0]); i += num[0].length; continue; }
    WORD.lastIndex = i;
    const word = WORD.exec(line);
    if (word) {
      const w = lang.caseInsensitive ? word[0].toLowerCase() : word[0];
      push(lang.keywords.has(w) ? "keyword" : "plain", word[0]);
      i += word[0].length;
      continue;
    }
    push("plain", line[i]);
    i++;
  }
  return { tokens: out, state: next };
}
