// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DirEntry } from "../../../src/files/filesApi";
import { absolutePath, extLabel, renderFileTree, type FileTreeModel } from "../../../src/ui/fileTree";

const dir = (name: string): DirEntry => ({ name, isDir: true });
const file = (name: string): DirEntry => ({ name, isDir: false });

function setup(model: Partial<FileTreeModel> & Pick<FileTreeModel, "children">) {
  const body = document.createElement("div");
  document.body.appendChild(body);
  const callbacks = { onToggle: vi.fn(), onOpen: vi.fn() };
  const full: FileTreeModel = { root: "/repo", expanded: new Set(), ...model };
  renderFileTree(body, full, callbacks);
  const rels = (): (string | undefined)[] => Array.from(body.querySelectorAll<HTMLElement>(".ft-row")).map((r) => r.dataset.rel);
  const row = (rel: string): HTMLElement => body.querySelector<HTMLElement>(`.ft-row[data-rel="${rel}"]`)!;
  return { body, callbacks, rels, row };
}

describe("renderFileTree", () => {
  it("shows No workspace for a null model", () => {
    const body = document.createElement("div");
    renderFileTree(body, null, { onToggle: vi.fn(), onOpen: vi.fn() });
    expect(body.textContent).toBe("No workspace");
  });

  it("renders the top level lazily and routes clicks", () => {
    const { callbacks, rels, row } = setup({ children: new Map([["", [dir("src"), file("a.ts")]]]) });
    expect(rels()).toEqual(["src", "a.ts"]);
    row("src").click();
    expect(callbacks.onToggle).toHaveBeenCalledWith("src");
    row("a.ts").click();
    expect(callbacks.onOpen).toHaveBeenCalledWith("a.ts");
  });

  it("renders no child rows for an expanded folder that is not loaded", () => {
    const { rels } = setup({ expanded: new Set(["src"]), children: new Map([["", [dir("src"), file("a.ts")]]]) });
    expect(rels()).toEqual(["src", "a.ts"]);
  });

  it("renders loaded children nested with guides", () => {
    const { rels, row } = setup({
      expanded: new Set(["src"]),
      children: new Map<string, readonly DirEntry[]>([
        ["", [dir("src"), file("a.ts")]],
        ["src", [file("main.ts")]],
      ]),
    });
    expect(rels()).toEqual(["src", "src/main.ts", "a.ts"]);
    expect(row("src/main.ts").querySelectorAll(".ft-guide")).toHaveLength(1);
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the backend order", () => {
    const { rels } = setup({ children: new Map([["", [dir("z"), dir("a"), file("b")]]]) });
    expect(rels()).toEqual(["z", "a", "b"]);
  });

  it("renders an error row for a folder that failed to load", () => {
    const { body } = setup({
      expanded: new Set(["src"]),
      children: new Map<string, readonly DirEntry[] | { error: string }>([
        ["", [dir("src")]],
        ["src", { error: "Access is denied." }],
      ]),
    });
    const err = body.querySelector(".ft-row--error");
    expect(err?.textContent).toBe("Access is denied.");
    expect(err?.hasAttribute("tabindex")).toBe(false);
  });

  it("sets the absolute path as the tooltip", () => {
    const children = new Map([["", [file("main.ts")]]]);
    expect(setup({ root: "C:\\repo", children }).row("main.ts").title).toBe("C:\\repo\\main.ts");
    expect(setup({ root: "/home/u/repo", children }).row("main.ts").title).toBe("/home/u/repo/main.ts");
    expect(absolutePath("C:\\repo", "src/main.ts")).toBe("C:\\repo\\src\\main.ts");
    expect(absolutePath("/home/u/repo/", "src/main.ts")).toBe("/home/u/repo/src/main.ts");
    expect(absolutePath("/home/u/repo", "")).toBe("/home/u/repo");
  });

  it("handles the keyboard", () => {
    const { row, callbacks } = setup({ children: new Map([["", [dir("src"), file("a.ts")]]]) });
    row("src").focus();
    row("src").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(row("a.ts"));
    row("a.ts").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(callbacks.onOpen).toHaveBeenCalledWith("a.ts");
    row("src").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(callbacks.onToggle).toHaveBeenCalledWith("src");
  });

  it("keeps focus on the same row across a re-render", () => {
    const { body, row, callbacks } = setup({ children: new Map([["", [dir("src"), file("a.ts")]]]) });
    row("a.ts").focus();
    renderFileTree(body, { root: "/repo", expanded: new Set(), children: new Map([["", [dir("src"), file("a.ts")]]]) }, callbacks);
    expect(document.activeElement).toBe(row("a.ts"));
  });
});

describe("extLabel", () => {
  it("lower-cases the extension and ignores dotfiles", () => {
    expect(extLabel("a.PHP")).toBe("php");
    expect(extLabel(".gitignore")).toBe("");
    expect(extLabel("Makefile")).toBe("");
  });
});
