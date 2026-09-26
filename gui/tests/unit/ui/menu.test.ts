// @vitest-environment jsdom
//
// Finding #1 (BLOCKER): the parent menu's outside-mousedown check closed
// itself when the pointer landed inside its own open submenu/swatch grid
// (a sibling element under `root`, not a child of `menuEl`), and its
// capture-phase keydown handler (via `highlight()` -> `closeSubmenu()`)
// swallowed keys meant for that submenu. These tests exercise the fixed
// `openMenu` against a real (jsdom) DOM, since the bug is specifically
// about DOM containment and `document`-level listener ordering that a
// plain-object fake can't reproduce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openMenu, type MenuItemSpec } from "../../../src/ui/menu";

let root: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
  root.remove();
});

function dispatchKeydown(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function dispatchMousedown(target: Element): void {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}

function dispatchClick(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function itemMenus(): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".menu"));
}

describe("openMenu: submenu outside-click containment (finding #1)", () => {
  it("a mousedown inside the open submenu does not close the parent or the submenu", () => {
    const onSelect = vi.fn();
    const items: MenuItemSpec[] = [
      { id: "parent", label: "Parent", submenu: [{ id: "child", label: "Child", onSelect }] },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers(); // let the deferred outside-mousedown listener attach

    // Open the submenu via ArrowRight on the highlighted (first) item.
    dispatchKeydown("ArrowRight");
    expect(itemMenus()).toHaveLength(2);

    const childItemEl = itemMenus()[1].querySelector<HTMLElement>('[data-item-id="child"]')!;
    dispatchMousedown(childItemEl);

    // A mousedown alone must not have disposed anything.
    expect(itemMenus()).toHaveLength(2);
    expect(onSelect).not.toHaveBeenCalled();

    // The follow-up click selects the item and closes the submenu it lives
    // in, as normal (the parent's own close-on-select is a separate,
    // untouched concern, not part of this finding) -- proving the
    // mousedown didn't leave anything in a broken half-disposed state.
    dispatchClick(childItemEl);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(itemMenus()).toHaveLength(1);
  });

  it("a mousedown inside the open swatch grid does not close the parent menu", () => {
    const onPick = vi.fn();
    const items: MenuItemSpec[] = [
      {
        id: "change-color",
        label: "Change Color",
        swatchSubmenu: { colors: ["#111", "#222", "#333"], currentIndex: 0, onPick },
      },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();

    dispatchKeydown("Enter"); // activate the highlighted item -> opens the swatch grid
    const grid = root.querySelector<HTMLElement>(".color-swatch-grid");
    expect(grid).not.toBeNull();

    const swatch = grid!.querySelectorAll<HTMLElement>(".color-swatch")[1];
    dispatchMousedown(swatch);
    // Still open: the parent menu and the grid both survive a mousedown
    // inside the grid.
    expect(root.querySelector(".menu")).not.toBeNull();
    expect(root.querySelector(".color-swatch-grid")).not.toBeNull();

    dispatchClick(swatch);
    expect(onPick).toHaveBeenCalledWith(1);
    expect(root.querySelector(".menu")).toBeNull();
  });

  it("a genuine outside mousedown still closes the whole chain", () => {
    const items: MenuItemSpec[] = [{ id: "parent", label: "Parent", submenu: [{ id: "child", label: "Child" }] }];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("ArrowRight");
    expect(itemMenus()).toHaveLength(2);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    dispatchMousedown(outside);
    expect(itemMenus()).toHaveLength(0);
    outside.remove();
  });
});

describe("openMenu: keyboard routing while a submenu is open (finding #1)", () => {
  it("ArrowDown navigates within the open submenu instead of being swallowed by the parent", () => {
    const items: MenuItemSpec[] = [
      {
        id: "parent",
        label: "Parent",
        submenu: [
          { id: "child-a", label: "A" },
          { id: "child-b", label: "B" },
        ],
      },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("ArrowRight");
    expect(itemMenus()).toHaveLength(2); // still open, submenu appeared

    const submenuEl = itemMenus()[1];
    const highlightedBefore = submenuEl.querySelector(".is-highlighted")?.getAttribute("data-item-id");
    expect(highlightedBefore).toBe("child-a");

    dispatchKeydown("ArrowDown");
    // The submenu must still be open (the bug: the parent's own ArrowDown
    // handler called `highlight()`, which called `closeSubmenu()`).
    expect(itemMenus()).toHaveLength(2);
    const highlightedAfter = itemMenus()[1].querySelector(".is-highlighted")?.getAttribute("data-item-id");
    expect(highlightedAfter).toBe("child-b");
  });

  it("Enter activates the highlighted item inside the open submenu", () => {
    const onSelect = vi.fn();
    const items: MenuItemSpec[] = [
      { id: "parent", label: "Parent", submenu: [{ id: "child", label: "Child", onSelect }] },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("ArrowRight");
    dispatchKeydown("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(itemMenus()).toHaveLength(1); // the submenu closed; the parent is untouched by this finding
  });

  it("Escape closes just the submenu, leaving the parent menu open", () => {
    const items: MenuItemSpec[] = [
      { id: "parent", label: "Parent", submenu: [{ id: "child", label: "Child" }] },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("ArrowRight");
    expect(itemMenus()).toHaveLength(2);

    dispatchKeydown("Escape");
    expect(itemMenus()).toHaveLength(1); // submenu gone, parent still open

    dispatchKeydown("Escape");
    expect(itemMenus()).toHaveLength(0); // now the parent closes too
  });

  it("ArrowLeft closes just a plain item submenu back to the parent", () => {
    const items: MenuItemSpec[] = [
      { id: "parent", label: "Parent", submenu: [{ id: "child", label: "Child" }] },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("ArrowRight");
    expect(itemMenus()).toHaveLength(2);
    dispatchKeydown("ArrowLeft");
    expect(itemMenus()).toHaveLength(1);
  });

  it("the swatch grid claims arrow keys for its own navigation instead of closing on ArrowLeft", () => {
    const onPick = vi.fn();
    const items: MenuItemSpec[] = [
      {
        id: "change-color",
        label: "Change Color",
        swatchSubmenu: { colors: ["#111", "#222", "#333", "#444", "#555", "#666"], currentIndex: 0, onPick },
      },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("Enter");
    const grid = root.querySelector<HTMLElement>(".color-swatch-grid")!;
    expect(grid).not.toBeNull();

    // Move right twice, then left once: net +1 from index 0 -> index 1.
    dispatchKeydown("ArrowRight");
    dispatchKeydown("ArrowRight");
    dispatchKeydown("ArrowLeft");
    // The grid must still be open (ArrowLeft navigated, it did not close).
    expect(root.querySelector(".color-swatch-grid")).not.toBeNull();

    dispatchKeydown("Enter");
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("Escape still closes just the swatch grid, back to the parent menu", () => {
    const items: MenuItemSpec[] = [
      {
        id: "change-color",
        label: "Change Color",
        swatchSubmenu: { colors: ["#111", "#222"], currentIndex: 0, onPick: vi.fn() },
      },
    ];
    openMenu(root, { left: 0, top: 0 }, items);
    vi.runAllTimers();
    dispatchKeydown("Enter");
    expect(root.querySelector(".color-swatch-grid")).not.toBeNull();

    dispatchKeydown("Escape");
    expect(root.querySelector(".color-swatch-grid")).toBeNull();
    expect(root.querySelector(".menu")).not.toBeNull(); // parent still open
  });
});
