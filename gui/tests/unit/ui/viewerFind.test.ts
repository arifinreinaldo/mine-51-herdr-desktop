// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../../../src/files/filesApi";
import { renderFileViewer, type ViewerContent } from "../../../src/ui/fileViewer";
import { closeViewerFind, findMatches, isViewerFindOpen, openViewerFind, stepIndex } from "../../../src/ui/viewerFind";

describe("findMatches", () => {
  it("finds every case-insensitive match, in line order", () => {
    expect(findMatches(["Foo foo", "bar", "FOO"], "foo")).toEqual([
      { line: 0, start: 0, end: 3 },
      { line: 0, start: 4, end: 7 },
      { line: 2, start: 0, end: 3 },
    ]);
  });

  it("does not overlap matches and returns none for an empty query", () => {
    expect(findMatches(["aaaa"], "aa")).toEqual([
      { line: 0, start: 0, end: 2 },
      { line: 0, start: 2, end: 4 },
    ]);
    expect(findMatches(["abc"], "")).toEqual([]);
  });
});

describe("stepIndex", () => {
  it("wraps both ways and starts from the right end", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("the bar", () => {
  afterEach(() => {
    closeViewerFind();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.textContent = "";
  });

  /** Renders `content` into `root` (a new element by default), as the viewer does. A re-render must not move `root`. */
  function viewer(content: ViewerContent, root: HTMLElement = document.createElement("div")): HTMLElement {
    if (!root.isConnected) document.body.appendChild(root);
    renderFileViewer(root, { root: "/p", tabs: ["a.ts"], active: "a.ts", content, view: { topLine: 0, currentLine: null } }, 13);
    return root;
  }

  const text = (t: string): ViewerContent => ({ kind: "text", text: t });

  function type(root: HTMLElement, value: string): void {
    const input = root.querySelector<HTMLInputElement>(".find-bar__input")!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }

  const count = (root: HTMLElement): string | null => root.querySelector(".find-bar__count")!.textContent;

  /** jsdom has no CSS Custom Highlight API: a Map stands in for the registry. */
  function stubHighlights(): Map<string, { ranges: Range[] }> {
    const registry = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal(
      "Highlight",
      class {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    return registry;
  }

  function pagedContent(search: (query: string) => Promise<SearchResult>): ViewerContent {
    const readLines = (start: number, n: number): Promise<string[]> => Promise.resolve(Array.from({ length: n }, (_, i) => `l${start + i}`));
    return { kind: "paged", file: { lineCount: 1_000_000, readLines, search } };
  }

  it("counts matches and steps with Enter and Shift+Enter", () => {
    const root = viewer(text("return x\nno match\nRETURN y"));
    openViewerFind(root);
    const input = root.querySelector<HTMLInputElement>(".find-bar__input")!;
    type(root, "return");
    expect(count(root)).toBe("1/2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(count(root)).toBe("2/2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
    expect(count(root)).toBe("1/2");
    type(root, "zzz");
    expect(count(root)).toBe("0/0");
  });

  it("finds a line far past the rendered rows and renders its row", () => {
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const root = viewer(text(Array.from({ length: 100_000 }, (_, i) => (i === 90_000 ? "needle" : `l${i}`)).join("\n")));
    expect(root.querySelector('.fv-line[data-line="90000"]')).toBeNull();
    openViewerFind(root);
    type(root, "needle");
    expect(count(root)).toBe("1/1");
    expect(root.querySelector('.fv-line[data-line="90000"] .fv-line__text')?.textContent).toBe("needle");
  });

  it("marks the matches of the rendered rows only, across token spans, and again after a scroll", () => {
    const registry = stubHighlights();
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const root = viewer(text(Array.from({ length: 1000 }, () => "return x").join("\n")));
    openViewerFind(root);
    type(root, "rn x"); // crosses the keyword span and the plain text after it
    expect(count(root)).toBe("1/1000");
    const rendered = root.querySelectorAll(".fv-line").length;
    expect(rendered).toBeLessThan(1000);
    expect(registry.get("fv-find")!.ranges).toHaveLength(rendered);
    expect(registry.get("fv-find")!.ranges[0].toString()).toBe("rn x");
    expect(registry.has("fv-find-current")).toBe(true);
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 600 * parseInt(root.querySelector<HTMLElement>(".fv-lines")!.style.getPropertyValue("--fv-row"));
    body.dispatchEvent(new Event("scroll"));
    const firstRow = root.querySelector<HTMLElement>(".fv-line")!;
    expect(firstRow.dataset.line).not.toBe("0");
    expect(registry.get("fv-find")!.ranges[0].startContainer.parentElement?.closest(".fv-line")).toBe(firstRow);
    expect(registry.has("fv-find-current")).toBe(false); // match 1 is on line 0, off screen now
  });

  it("keeps the bar and its focus over a refresh render, and searches the new lines", () => {
    const root = viewer(text("a\nb"));
    openViewerFind(root);
    type(root, "c");
    expect(count(root)).toBe("0/0");
    const input = root.querySelector(".find-bar__input");
    viewer(text("c\nc"), root); // what a refresh does: the same element, new text
    expect(root.querySelector(".find-bar__input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(count(root)).toBe("1/2");
  });

  it("searches a paged file through the backend after a pause, shows Searching meanwhile, and marks a capped count with +", async () => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const queries: string[] = [];
    const root = viewer(
      pagedContent((query) => {
        queries.push(query);
        return Promise.resolve({ matches: [{ line: 900_000, col: 1 }], truncated: true });
      }),
    );
    openViewerFind(root);
    const input = root.querySelector<HTMLInputElement>(".find-bar__input")!;
    type(root, "9");
    type(root, "90");
    expect(queries).toEqual([]);
    expect(count(root)).toBe("Searching…");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); // no old matches to step
    expect(count(root)).toBe("Searching…");
    await vi.advanceTimersByTimeAsync(300);
    expect(queries).toEqual(["90"]);
    expect(count(root)).toBe("1/1+");
    await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="900000"] .fv-line__text')?.textContent).toBe("l900000"));
  });

  it("shows a backend error in the bar", async () => {
    vi.useFakeTimers();
    const root = viewer(pagedContent(() => Promise.reject({ code: "io_error", message: "disk gone" })));
    openViewerFind(root);
    type(root, "x");
    await vi.advanceTimersByTimeAsync(300);
    expect(count(root)).toBe("disk gone");
  });

  it("stops a running backend search when the query empties and when the bar closes", async () => {
    vi.useFakeTimers();
    const queries: string[] = [];
    const root = viewer(
      pagedContent((query) => {
        queries.push(query);
        return new Promise(() => {});
      }),
    );
    openViewerFind(root);
    type(root, "x");
    await vi.advanceTimersByTimeAsync(300);
    type(root, "");
    expect(queries).toEqual(["x", ""]);
    type(root, "y");
    await vi.advanceTimersByTimeAsync(300);
    closeViewerFind();
    expect(queries).toEqual(["x", "", "y", ""]);
  });

  it("Esc closes the bar without the event reaching the viewer", () => {
    const root = viewer(text("x"));
    let reached = false;
    root.addEventListener("keydown", () => (reached = true));
    openViewerFind(root);
    root.querySelector(".find-bar__input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isViewerFindOpen()).toBe(false);
    expect(root.querySelector(".find-bar")).toBeNull();
    expect(reached).toBe(false);
  });

  it("opening twice keeps one bar", () => {
    const root = viewer(text("x"));
    openViewerFind(root);
    openViewerFind(root);
    expect(root.querySelectorAll(".find-bar")).toHaveLength(1);
  });
});
