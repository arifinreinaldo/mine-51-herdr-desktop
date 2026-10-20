// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { absolutePath } from "../../../src/ui/fileTree";
import {
  closeTab,
  cycleTab,
  openTab,
  renderFileViewer,
  viewOf,
  type FileViewerCallbacks,
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
  renderFileViewer(
    root,
    {
      root: ROOT,
      tabs,
      active: opts.active === undefined ? tabs[0] : opts.active,
      content: opts.content ?? { kind: "text", text: "one\ntwo\nthree\nfour\n" },
      view: opts.view ?? { scrollTop: 0, currentLine: null },
    },
    13,
    opts.cb ?? callbacks(),
  );
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
    viewOf(s, "a").scrollTop = 5;
    viewOf(s, "b").scrollTop = 9;
    closeTab(s, "a");
    expect([...s.views.keys()]).toEqual(["b"]);
    expect(viewOf(s, "b").scrollTop).toBe(9);
  });

  it("viewOf creates a default view once", () => {
    const s = state();
    expect(viewOf(s, "a")).toEqual({ scrollTop: 0, currentLine: null });
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
    [{ kind: "tooLarge", size: 3 * 1048576 }, "File too large to show (3.0 MB, limit 2 MB)"],
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

  it("renders 5,000 rows and a notice for 5,001 lines", () => {
    const text = Array.from({ length: 5001 }, (_, i) => `l${i}`).join("\n");
    const root = render({ content: { kind: "text", text } });
    expect(root.querySelectorAll(".fv-line")).toHaveLength(5000);
    expect(root.querySelector(".fv-notice")?.textContent).toBe("Showing the first 5,000 of 5,001 lines");
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

describe("tab view (W3)", () => {
  it("restores the scroll position and the current line", () => {
    const root = render({ view: { scrollTop: 120, currentLine: 3 } });
    expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).toBe(120);
    const rows = Array.from(root.querySelectorAll(".fv-line"));
    expect(rows.map((r) => r.classList.contains("is-current"))).toEqual([false, false, false, true]);
  });

  it("saves the scroll position and the clicked line", () => {
    const view: TabView = { scrollTop: 0, currentLine: null };
    const root = render({ view });
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 300;
    body.dispatchEvent(new Event("scroll"));
    expect(view.scrollTop).toBe(300);
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
    const view: TabView = { scrollTop: 0, currentLine: null };
    const root = document.createElement("div");
    const model = { root: ROOT, tabs: ["a.ts"], active: "a.ts", content: { kind: "text", text: "a\nb\nc" } as ViewerContent, view };
    renderFileViewer(root, model, 13, callbacks());
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 77;
    body.dispatchEvent(new Event("scroll"));
    root.querySelectorAll(".fv-line")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderFileViewer(root, model, 13, callbacks());
    expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).toBe(77);
    expect(root.querySelector(".fv-line.is-current")?.getAttribute("data-line")).toBe("1");
  });

  it("does not throw when no tab is active", () => {
    expect(() => render({ tabs: [], active: null, content: { kind: "loading" } })).not.toThrow();
  });
});
