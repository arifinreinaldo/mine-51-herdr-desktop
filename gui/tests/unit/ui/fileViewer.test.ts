// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { absolutePath } from "../../../src/ui/fileTree";
import {
  closeTab,
  cycleTab,
  openTab,
  renderFileTabs,
  renderFileViewer,
  viewOf,
  type FileViewerCallbacks,
  type FileViewerModel,
  type TabState,
  type TabView,
  type ViewerContent,
} from "../../../src/ui/fileViewer";

const ROOT = "/home/me/proj";

function state(tabs: string[] = [], active: string | null = null): TabState {
  return { tabs, active, views: new Map() };
}

function callbacks(): FileViewerCallbacks & { activated: string[]; closed: string[] } {
  const activated: string[] = [];
  const closed: string[] = [];
  return { activated, closed, onActivate: (r) => activated.push(r), onClose: (r) => closed.push(r) };
}

function render(
  opts: { tabs?: string[]; active?: string | null; content?: ViewerContent; view?: TabView; cb?: FileViewerCallbacks } = {},
): HTMLElement {
  const root = document.createElement("div");
  const tabs = opts.tabs ?? ["a.ts"];
  const active = opts.active === undefined ? tabs[0] : opts.active;
  renderFileViewer(
    root,
    {
      root: ROOT,
      tabs,
      active,
      content: opts.content ?? { kind: "text", text: "one\ntwo\nthree\nfour\n" },
      view: opts.view ?? { topLine: 0, currentLine: null },
    },
    13,
  );
  // The tab strip renders apart from the viewer (the page's bottom strip); kept in one root for the queries.
  const strip = document.createElement("div");
  renderFileTabs(strip, { root: ROOT, tabs, active }, opts.cb ?? callbacks());
  root.appendChild(strip);
  return root;
}

describe("tab helpers", () => {
  it("opens tabs and dedupes", () => {
    const s = state();
    openTab(s, "a");
    openTab(s, "b");
    expect(s.tabs).toEqual(["a", "b"]);
    expect(s.active).toBe("b");
    openTab(s, "a");
    expect(s.tabs).toEqual(["a", "b"]);
    expect(s.active).toBe("a");
  });

  it("closing the active tab activates the neighbour, the last close gives null", () => {
    const s = state(["a", "b", "c"], "b");
    closeTab(s, "b");
    expect(s.tabs).toEqual(["a", "c"]);
    expect(s.active).toBe("c");
    closeTab(s, "c");
    expect(s.active).toBe("a");
    closeTab(s, "a");
    expect(s.active).toBeNull();
  });

  it("closing a background tab keeps the active tab", () => {
    const s = state(["a", "b", "c"], "c");
    closeTab(s, "a");
    expect(s.active).toBe("c");
  });

  it("closeTab deletes the view of the closed tab only", () => {
    const s = state(["a", "b"], "a");
    viewOf(s, "a").topLine = 5;
    viewOf(s, "b").topLine = 9;
    closeTab(s, "a");
    expect([...s.views.keys()]).toEqual(["b"]);
    expect(viewOf(s, "b").topLine).toBe(9);
  });

  it("viewOf creates a default view once", () => {
    const s = state();
    expect(viewOf(s, "a")).toEqual({ topLine: 0, currentLine: null });
    expect(viewOf(s, "a")).toBe(viewOf(s, "a"));
  });

  it("cycles and wraps in both directions", () => {
    const s = state(["a", "b", "c"], "c");
    cycleTab(s, 1);
    expect(s.active).toBe("a");
    cycleTab(s, -1);
    expect(s.active).toBe("c");
    cycleTab(s, -1);
    expect(s.active).toBe("b");
  });

  it("cycle does nothing without an active tab", () => {
    const s = state(["a"], null);
    cycleTab(s, 1);
    expect(s.active).toBeNull();
  });
});

describe("tab row", () => {
  it("shows the parent folder only for tabs with the same file name", () => {
    const tabs = ["a/index.ts", "b/index.ts", "c.ts"];
    const root = render({ tabs, active: tabs[0] });
    expect(Array.from(root.querySelectorAll(".fv-tab__dir")).map((n) => n.textContent)).toEqual(["a", "b"]);
    const titles = Array.from(root.querySelectorAll<HTMLElement>(".fv-tab")).map((n) => n.title);
    expect(titles).toEqual(tabs.map((t) => absolutePath(ROOT, t)));
  });

  it("marks the active tab and uses a file icon without an extension", () => {
    const root = render({ tabs: ["a.ts", "Makefile"], active: "Makefile" });
    const tabs = root.querySelectorAll(".fv-tab");
    expect(tabs[0].classList.contains("is-active")).toBe(false);
    expect(tabs[1].classList.contains("is-active")).toBe(true);
    expect(tabs[0].querySelector(".fv-tab__ext")?.textContent).toBe("ts");
    expect(tabs[1].querySelector(".codicon-file")).not.toBeNull();
  });

  it("calls onActivate on a tab click, onClose on the close span and on a middle click", () => {
    const cb = callbacks();
    const root = render({ tabs: ["a.ts", "b.ts"], active: "a.ts", cb });
    const tabs = root.querySelectorAll<HTMLElement>(".fv-tab");
    tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cb.activated).toEqual(["b.ts"]);
    tabs[0].querySelector<HTMLElement>(".fv-tab__close")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cb.closed).toEqual(["a.ts"]);
    expect(cb.activated).toEqual(["b.ts"]);
    tabs[1].dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(cb.closed).toEqual(["a.ts", "b.ts"]);
    tabs[1].dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(cb.closed).toHaveLength(2);
  });

  it("marks no tab active while the viewer is hidden (active null) and renders no tabs inside the viewer", () => {
    const strip = document.createElement("div");
    renderFileTabs(strip, { root: ROOT, tabs: ["a.ts", "b.ts"], active: null }, callbacks());
    expect(strip.querySelectorAll(".fv-tab")).toHaveLength(2);
    expect(strip.querySelector(".fv-tab.is-active")).toBeNull();
    const viewer = document.createElement("div");
    renderFileViewer(
      viewer,
      { root: ROOT, tabs: ["a.ts"], active: "a.ts", content: { kind: "text", text: "x" }, view: { topLine: 0, currentLine: null } },
      13,
    );
    expect(viewer.querySelector(".fv-tab")).toBeNull();
  });

  it("re-rendering the strip replaces its tabs", () => {
    const strip = document.createElement("div");
    renderFileTabs(strip, { root: ROOT, tabs: ["a.ts", "b.ts"], active: "a.ts" }, callbacks());
    renderFileTabs(strip, { root: ROOT, tabs: ["b.ts"], active: "b.ts" }, callbacks());
    expect(Array.from(strip.querySelectorAll<HTMLElement>(".fv-tab")).map((t) => t.dataset.rel)).toEqual(["b.ts"]);
  });

  it("prevents the default of a middle mousedown", () => {
    const root = render();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    root.querySelector(".fv-tab")!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const left = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    root.querySelector(".fv-tab")!.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(false);
  });
});

describe("body", () => {
  it.each<[ViewerContent, string]>([
    [{ kind: "loading" }, "Loading…"],
    [{ kind: "binary" }, "Binary file, not shown"],
    [{ kind: "missing" }, "File not found. It was moved or deleted."],
    [{ kind: "error", message: "Not a regular file: src" }, "Not a regular file: src"],
  ])("renders a notice for %o", (content, text) => {
    const root = render({ content });
    expect(root.querySelector(".fv-notice")?.textContent).toBe(text);
    expect(root.querySelectorAll(".fv-line")).toHaveLength(0);
  });

  it("renders numbered lines and drops the trailing empty line", () => {
    const root = render();
    const rows = Array.from(root.querySelectorAll(".fv-line"));
    expect(rows).toHaveLength(4);
    expect(rows[3].querySelector(".fv-line__no")?.textContent).toBe("4");
    expect(rows[3].querySelector(".fv-line__text")?.textContent).toBe("four");
  });

  it("highlights tokens of a known language", () => {
    const root = render({ tabs: ["a.ts"], content: { kind: "text", text: "const x = 1;" } });
    expect(root.querySelector(".tok-keyword")?.textContent).toBe("const");
    expect(root.querySelector(".tok-number")?.textContent).toBe("1");
  });

  it("ends the breadcrumb with Read-only", () => {
    const root = render({ tabs: ["src/a.ts"], active: "src/a.ts" });
    const crumb = root.querySelector(".fv-breadcrumb")!;
    expect(crumb.lastElementChild?.textContent).toBe("Read-only");
    expect(crumb.textContent).toBe("proj › src › a.ts" + "Read-only");
  });
});

const rowPx = (root: HTMLElement): number => parseInt(root.querySelector<HTMLElement>(".fv-lines")!.style.getPropertyValue("--fv-row"));
const shown = (root: HTMLElement): number[] => Array.from(root.querySelectorAll<HTMLElement>(".fv-line"), (row) => Number(row.dataset.line));
const manyLines = (n: number, line: (i: number) => string = (i) => `l${i}`): string => Array.from({ length: n }, (_, i) => line(i)).join("\n");

function scrollTo(root: HTMLElement, line: number): void {
  const body = root.querySelector<HTMLElement>(".fv-body")!;
  body.scrollTop = line * rowPx(root);
  body.dispatchEvent(new Event("scroll"));
}

function paged(lineCount: number, calls: number[][] = []): ViewerContent {
  return {
    kind: "paged",
    file: {
      lineCount,
      readLines: (start, n) => {
        calls.push([start, n]);
        return Promise.resolve(Array.from({ length: Math.min(n, lineCount - start) }, (_, i) => `p${start + i}`));
      },
      search: () => Promise.resolve({ matches: [], truncated: false }),
    },
  };
}

describe("virtual rows", () => {
  // jsdom has no layout: give every element a 200 px viewport. A braced body: a returned spy would run as teardown.
  beforeEach(() => {
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders only the rows near the viewport, and the rows of a deep scroll", () => {
    const root = render({ content: { kind: "text", text: manyLines(100_000) } });
    expect(root.querySelector<HTMLElement>(".fv-lines")!.style.height).toBe(`${100_000 * rowPx(root)}px`);
    expect(shown(root)[0]).toBe(0);
    expect(shown(root).length).toBeLessThan(100);
    scrollTo(root, 99_990);
    expect(shown(root)).toContain(99_999);
    expect(root.querySelector('.fv-line[data-line="99999"] .fv-line__text')?.textContent).toBe("l99999");
    expect(root.querySelector(".fv-notice")).toBeNull();
  });

  it("carries a block comment into a deep row through the checkpoints", () => {
    const open = render({ content: { kind: "text", text: "/*\n" + manyLines(5000, () => "const") } });
    scrollTo(open, 4000);
    expect(open.querySelector('.fv-line[data-line="4000"] .tok-comment')?.textContent).toBe("const");
    scrollTo(open, 1000); // back up: the walk starts at a stored checkpoint
    expect(open.querySelector('.fv-line[data-line="1000"] .tok-comment')?.textContent).toBe("const");
    const closed = render({ content: { kind: "text", text: "/* */\n" + manyLines(5000, () => "const") } });
    scrollTo(closed, 4000);
    expect(closed.querySelector('.fv-line[data-line="4000"] .tok-keyword')?.textContent).toBe("const");
  });

  it("caps the spacer of a very long file and still reaches its middle and last lines", () => {
    const root = render({ content: { kind: "text", text: manyLines(1_000_000) } });
    expect(root.querySelector<HTMLElement>(".fv-lines")!.style.height).toBe("16000000px");
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 8_000_000;
    body.dispatchEvent(new Event("scroll"));
    expect(shown(root)).toContain(500_000);
    body.scrollTop = 16_000_000;
    body.dispatchEvent(new Event("scroll"));
    expect(shown(root)).toContain(999_999);
  });

  it("keeps the top line when a refresh render adds lines to a scaled file", () => {
    const view: TabView = { topLine: 0, currentLine: null };
    const root = document.createElement("div");
    const model = (n: number): FileViewerModel => ({ root: ROOT, tabs: ["a.ts"], active: "a.ts", content: { kind: "text", text: manyLines(n) }, view });
    renderFileViewer(root, model(1_000_000), 13);
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 8_000_000;
    body.dispatchEvent(new Event("scroll"));
    const top = view.topLine;
    renderFileViewer(root, model(1_100_000), 13);
    expect(view.topLine).toBe(top);
    expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).not.toBe(8_000_000); // the same line, a new scroll position
    expect(shown(root)[0]).toBe(Math.floor(top) - 20);
  });

  it("keeps the scroll width of the widest painted row after a scroll into short lines and a refresh", () => {
    // jsdom has no layout: a text span is 8 px per character.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return (this.textContent?.length ?? 0) * 8;
    });
    const view: TabView = { topLine: 0, currentLine: null };
    const text = manyLines(1000, (i) => (i === 0 ? "x".repeat(500) : "y"));
    const root = render({ content: { kind: "text", text }, view });
    const width = (r: HTMLElement): string => r.querySelector<HTMLElement>(".fv-lines")!.style.width;
    expect(width(root)).toBe("4000px");
    scrollTo(root, 600);
    expect(width(root)).toBe("4000px");
    expect(width(render({ content: { kind: "text", text }, view }))).toBe("4000px");
  });

  it("clamps the current line when a new render makes the file shorter", () => {
    const view: TabView = { topLine: 0, currentLine: 9 };
    const root = render({ content: { kind: "text", text: "a\nb\nc" }, view });
    expect(view.currentLine).toBe(2);
    expect(root.querySelector(".fv-line.is-current")?.getAttribute("data-line")).toBe("2");
  });

  it("paged mode shows placeholder rows, fetches the page near the viewport, then shows its lines", async () => {
    const calls: number[][] = [];
    const root = render({ content: paged(100_000, calls) });
    expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("");
    expect(calls).toEqual([[0, 500]]);
    await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("p0"));
    scrollTo(root, 70_000);
    expect(calls).toContainEqual([70_000, 500]);
    await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="70000"] .fv-line__text')?.textContent).toBe("p70000"));
  });

  it("paged mode keeps at most 8 pages and fetches a dropped page again", () => {
    const calls: number[][] = [];
    const root = render({ content: paged(100_000, calls) });
    for (let line = 1000; line <= 9000; line += 1000) scrollTo(root, line);
    scrollTo(root, 0);
    expect(calls.filter(([start]) => start === 0)).toHaveLength(2);
  });

  it("paged mode shows the old lines while a refresh render fetches the pages again", async () => {
    const root = document.createElement("div");
    const model = (content: ViewerContent): FileViewerModel => ({ root: ROOT, tabs: ["a.ts"], active: "a.ts", content, view: { topLine: 0, currentLine: null } });
    renderFileViewer(root, model(paged(100)), 13);
    await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("p0"));
    const pending: ViewerContent = {
      kind: "paged",
      file: { lineCount: 100, readLines: () => new Promise(() => {}), search: () => Promise.resolve({ matches: [], truncated: false }) },
    };
    renderFileViewer(root, model(pending), 13);
    expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("p0");
  });
});

describe("tab view (W3)", () => {
  it("restores the scroll position and the current line", () => {
    const root = render({ view: { topLine: 2, currentLine: 3 } });
    expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).toBe(2 * rowPx(root));
    const rows = Array.from(root.querySelectorAll(".fv-line"));
    expect(rows.map((r) => r.classList.contains("is-current"))).toEqual([false, false, false, true]);
  });

  it("saves the scroll position and the clicked line", () => {
    const view: TabView = { topLine: 0, currentLine: null };
    const root = render({ view });
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 2 * rowPx(root);
    body.dispatchEvent(new Event("scroll"));
    expect(view.topLine).toBe(2);
    root.querySelectorAll(".fv-line")[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(view.currentLine).toBe(2);
  });

  it("keeps exactly one current line after clicks", () => {
    const root = render();
    const rows = root.querySelectorAll(".fv-line");
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    rows[3].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelectorAll(".fv-line.is-current")).toHaveLength(1);
    expect(rows[3].classList.contains("is-current")).toBe(true);
  });

  it("restores both again on a re-render with the same view", () => {
    const view: TabView = { topLine: 0, currentLine: null };
    const root = document.createElement("div");
    const model = { root: ROOT, tabs: ["a.ts"], active: "a.ts", content: { kind: "text", text: "a\nb\nc" } as ViewerContent, view };
    renderFileViewer(root, model, 13);
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = rowPx(root);
    body.dispatchEvent(new Event("scroll"));
    root.querySelectorAll(".fv-line")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderFileViewer(root, model, 13);
    expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).toBeCloseTo(rowPx(root));
    expect(root.querySelector(".fv-line.is-current")?.getAttribute("data-line")).toBe("1");
  });

  it("saves and restores the horizontal scroll position", () => {
    const view: TabView = { topLine: 0, currentLine: null };
    const body = render({ view }).querySelector<HTMLElement>(".fv-body")!;
    body.scrollLeft = 40;
    body.dispatchEvent(new Event("scroll"));
    expect(view.scrollLeft).toBe(40);
    expect(render({ view }).querySelector<HTMLElement>(".fv-body")!.scrollLeft).toBe(40);
  });

  it("does not throw when no tab is active", () => {
    expect(() => render({ tabs: [], active: null, content: { kind: "loading" } })).not.toThrow();
  });
});
