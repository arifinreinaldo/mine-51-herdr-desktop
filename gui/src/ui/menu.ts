// Generic popup menu renderer, shared by the menu bar (spec phase1.5 §4)
// and the sidebar/tab context menus (§5/§6). DOM wiring only; the item
// data (labels, shortcuts, actions) is built by the caller.

import { closeActiveOverlay, notifyOverlayClosed, openOverlay } from "./overlay";
import { createStatusDot, type AgentStatus } from "./statusDot";

export interface MenuItemSpec {
  id: string;
  label: string;
  /** Right-aligned hint text, e.g. `"Ctrl+Shift+N"`. */
  shortcut?: string;
  /** A `codicon-*` suffix shown left of the label when highlighted/always
   * (mirrors the mock: the icon only shows on the highlighted item). */
  icon?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  /** A badge dot (spec §1 "herdr menu": the update-available dot). */
  dot?: boolean;
  /** An agent status dot shown left of the label (the tab overflow list). */
  status?: AgentStatus | null;
  separatorBefore?: boolean;
  submenu?: readonly MenuItemSpec[];
  /** A submenu rendered as a swatch grid instead of a normal item list
   * (spec §6a "Change Color ▸"). */
  swatchSubmenu?: { colors: readonly string[]; currentIndex: number; onPick: (index: number) => void };
  onSelect?: () => void;
}

export interface MenuPosition {
  left: number;
  top: number;
}

function buildItemEl(
  item: MenuItemSpec,
  onActivate: (item: MenuItemSpec) => void,
  reserveIconSlot: boolean,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "menu-item";
  el.setAttribute("role", "menuitem");
  el.tabIndex = -1;
  if (item.danger) el.classList.add("is-danger");
  if (item.disabled) el.classList.add("is-disabled");
  // Items without their own icon keep the menu's *current* alignment; the
  // left icon slot is reserved for every item in the menu only when at
  // least one item in it actually has an icon or checkmark (mock-b.png /
  // the Pane menu and tab context menu), so a menu with no icons at all
  // (Tab, Help, ...) is unaffected.
  if (reserveIconSlot) el.classList.add("menu-item--icon-slot");
  el.dataset.itemId = item.id;

  if (item.icon) {
    const icon = document.createElement("i");
    icon.className = `codicon codicon-${item.icon} menu-item__icon`;
    el.appendChild(icon);
  }
  if (item.checked) {
    const check = document.createElement("i");
    check.className = "codicon codicon-check menu-checkmark";
    el.appendChild(check);
  }

  // `null` keeps the dot's width empty so labels stay aligned.
  if (item.status) el.appendChild(createStatusDot(item.status));
  else if (item.status === null) el.appendChild(document.createElement("span")).className = "menu-item__no-dot";

  const label = document.createElement("span");
  label.className = "menu-item__label";
  label.textContent = item.label;
  el.appendChild(label);

  if (item.submenu || item.swatchSubmenu) {
    const chevron = document.createElement("i");
    chevron.className = "codicon codicon-chevron-right menu-item__key";
    el.appendChild(chevron);
  } else if (item.dot) {
    const dot = document.createElement("span");
    dot.className = "menu-dot menu-item__dot";
    el.appendChild(dot);
  } else if (item.shortcut) {
    const key = document.createElement("span");
    key.className = "menu-item__key";
    key.textContent = item.shortcut;
    el.appendChild(key);
  }

  if (!item.disabled) {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      onActivate(item);
    });
  }
  return el;
}

interface RenderMenuOptions {
  /** A non-interactive heading row above the items. */
  heading?: string;
  onClose?: () => void;
  returnFocusTo?: HTMLElement;
  /** Internal: submenus render inside the same overlay chain but don't
   * register themselves with the global overlay tracker or close it on
   * open -- their lifecycle belongs to the parent item's hover state. */
  isSubmenu?: boolean;
  /** Top-level menu bar only (never passed for a submenu): Left/Right move
   * to the previous/next top-level menu and open it, wrapping (spec §4).
   * `-1` = previous (Left), `1` = next (Right). Only reached when there is
   * no open submenu and, for Right, the highlighted item has no submenu of
   * its own -- that case still opens the submenu instead (existing
   * behavior). Omitted for any menu that isn't a top-level bar menu (a tab
   * or sidebar context menu), which keeps doing nothing on a plain
   * Left/Right, as before. */
  onSwitchTopLevel?: (direction: 1 | -1) => void;
}

/**
 * Renders `items` as a `.menu` positioned at `position`, wired for click,
 * hover-highlight, one level of submenu (opened on hover), arrow-key
 * navigation, Enter to activate, and Esc/outside-click to close (closing
 * the whole chain). Returns a disposer.
 */
export function openMenu(
  root: HTMLElement,
  position: MenuPosition,
  items: readonly MenuItemSpec[],
  options: RenderMenuOptions = {},
): () => void {
  const menuEl = document.createElement("div");
  menuEl.className = "menu";
  menuEl.style.left = `${position.left}px`;
  menuEl.style.top = `${position.top}px`;
  menuEl.setAttribute("role", "menu");

  const reserveIconSlot = items.some((item) => Boolean(item.icon) || Boolean(item.checked));

  let highlightedIndex = -1;
  let openSubDispose: (() => void) | null = null;
  /** The open submenu/swatch grid's own root element (finding #1 BLOCKER):
   * it renders as a sibling of `menuEl` under `root`, not a child of it, so
   * `menuEl.contains(...)` alone can never tell a click inside it apart
   * from a genuine outside click. */
  let openSubEl: HTMLElement | null = null;
  /** A plain item-list submenu claims Esc *and* Left to close back to the
   * parent; the swatch grid claims Left (and the other three arrows) for
   * its own 2D navigation instead, so only Esc closes it (finding #1). */
  let openSubKind: "menu" | "swatch" | null = null;
  const itemEls: HTMLElement[] = [];

  const closeSubmenu = () => {
    if (openSubDispose) {
      const d = openSubDispose;
      openSubDispose = null;
      openSubEl = null;
      openSubKind = null;
      d();
    }
  };

  const highlight = (index: number) => {
    closeSubmenu();
    itemEls[highlightedIndex]?.classList.remove("is-highlighted");
    highlightedIndex = index;
    const el = itemEls[highlightedIndex];
    el?.classList.add("is-highlighted");
    el?.focus();
  };

  const activate = (item: MenuItemSpec) => {
    if (item.disabled) return;
    if (item.submenu) {
      openSubmenuFor(item);
      return;
    }
    if (item.swatchSubmenu) {
      openSwatchSubmenuFor(item);
      return;
    }
    dispose();
    item.onSelect?.();
  };

  function openSubmenuFor(item: MenuItemSpec): void {
    closeSubmenu();
    const index = items.indexOf(item);
    const itemEl = itemEls[index];
    if (!itemEl || !item.submenu) return;
    const rect = itemEl.getBoundingClientRect();
    openSubDispose = openMenu(root, { left: rect.right, top: rect.top }, item.submenu, {
      isSubmenu: true,
    });
    // `openMenu` appends its element synchronously before returning, so it
    // is already in `root`'s children by the time we get here.
    openSubEl = (root.lastElementChild as HTMLElement | null) ?? null;
    openSubKind = "menu";
  }

  /** A 5×2 grid (spec §6a): `GRID_COLS` matches `.color-swatch-grid`'s CSS
   * `grid-template-columns: repeat(5, ...)`. Arrow keys move a keyboard
   * "focused" swatch (finding #1 "Swatch grid must be keyboard
   * navigable"); Enter picks it; Esc closes it (handled by the parent's
   * `onKeydown` below, uniformly with a plain item submenu). */
  const GRID_COLS = 5;

  function openSwatchSubmenuFor(item: MenuItemSpec): void {
    closeSubmenu();
    const index = items.indexOf(item);
    const itemEl = itemEls[index];
    if (!itemEl || !item.swatchSubmenu) return;
    const rect = itemEl.getBoundingClientRect();
    const { colors, currentIndex, onPick } = item.swatchSubmenu;
    const grid = document.createElement("div");
    grid.className = "menu color-swatch-grid";
    grid.style.left = `${rect.right}px`;
    grid.style.top = `${rect.top}px`;
    grid.style.minWidth = "0";
    const swatchEls: HTMLElement[] = [];
    colors.forEach((color, i) => {
      const swatch = document.createElement("span");
      swatch.className = "color-swatch" + (i === currentIndex ? " is-current" : "");
      swatch.style.background = color;
      swatch.tabIndex = -1;
      swatch.addEventListener("click", (event) => {
        event.stopPropagation();
        dispose();
        onPick(i);
      });
      grid.appendChild(swatch);
      swatchEls.push(swatch);
    });

    let focusedSwatch = Math.max(0, currentIndex);
    const setFocusedSwatch = (next: number) => {
      swatchEls[focusedSwatch]?.classList.remove("is-focused");
      focusedSwatch = ((next % swatchEls.length) + swatchEls.length) % swatchEls.length;
      swatchEls[focusedSwatch]?.classList.add("is-focused");
      swatchEls[focusedSwatch]?.focus();
    };

    const onGridKeydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setFocusedSwatch(focusedSwatch + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setFocusedSwatch(focusedSwatch - 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedSwatch(focusedSwatch + GRID_COLS);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedSwatch(focusedSwatch - GRID_COLS);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dispose();
        onPick(focusedSwatch);
      }
    };
    document.addEventListener("keydown", onGridKeydown, true);

    root.appendChild(grid);
    setFocusedSwatch(focusedSwatch);
    openSubDispose = () => {
      document.removeEventListener("keydown", onGridKeydown, true);
      grid.remove();
    };
    openSubEl = grid;
    openSubKind = "swatch";
  }

  if (options.heading) {
    const heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = options.heading;
    menuEl.appendChild(heading);
  }

  for (const item of items) {
    // No separator above the first item: a leading rule would hang off the menu edge.
    if (item.separatorBefore && itemEls.length > 0) {
      const hr = document.createElement("hr");
      hr.className = "menu-separator";
      menuEl.appendChild(hr);
    }
    const el = buildItemEl(item, activate, reserveIconSlot);
    el.addEventListener("mouseenter", () => {
      const index = itemEls.indexOf(el);
      highlight(index);
    });
    menuEl.appendChild(el);
    itemEls.push(el);
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (openSubDispose) {
      // BLOCKER (finding #1): a submenu/swatch grid is open and owns its
      // own arrow/Enter navigation (both listeners are on `document`, and
      // this one -- registered first, when *this* menu opened -- would
      // otherwise run first on every keydown and, via `highlight()` above
      // calling `closeSubmenu()`, swallow keys meant for the submenu. The
      // parent only ever closes it back, on Esc (either kind) or Left (a
      // plain item submenu only -- the swatch grid claims Left for its own
      // navigation instead).
      if (event.key === "Escape" || (event.key === "ArrowLeft" && openSubKind === "menu")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSubmenu();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight((highlightedIndex + 1) % itemEls.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight((highlightedIndex - 1 + itemEls.length) % itemEls.length);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[highlightedIndex];
      if (item) activate(item);
      return;
    }
    // Left switches to the previous top-level menu (spec §4), but only for
    // a top-level bar menu (`onSwitchTopLevel` passed) -- a tab/sidebar
    // context menu, or a submenu (which never gets this option), keeps
    // doing nothing on a plain Left, same as before this feature existed.
    if (event.key === "ArrowLeft") {
      if (options.onSwitchTopLevel) {
        event.preventDefault();
        options.onSwitchTopLevel(-1);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      const item = items[highlightedIndex];
      if (item?.submenu) {
        event.preventDefault();
        openSubmenuFor(item);
      } else if (options.onSwitchTopLevel) {
        // Right on an item with no submenu switches to the next top-level
        // menu; Right on an item *with* a submenu (handled above) still
        // opens it instead -- that precedence is the spec's one exception.
        event.preventDefault();
        options.onSwitchTopLevel(1);
      }
      return;
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  const onOutsideClick = (event: MouseEvent) => {
    const target = event.target as Node;
    // BLOCKER (finding #1): the submenu/swatch grid renders as a sibling
    // of `menuEl`, not a child, so a mousedown inside it must count as
    // "inside" here too -- otherwise it closes the whole chain before the
    // submenu item's own `click` handler (which fires after `mousedown`)
    // ever gets a chance to run.
    if (menuEl.contains(target) || (openSubEl && openSubEl.contains(target))) return;
    dispose();
  };
  // Deferred so the click that opened this menu doesn't immediately close it.
  window.setTimeout(() => document.addEventListener("mousedown", onOutsideClick), 0);

  root.appendChild(menuEl);
  // Highlights the first *enabled* item (spec §4: switching a top-level
  // menu highlights "its first enabled item"), not just index 0 -- matters
  // whenever a menu's very first entry happens to be disabled.
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  if (firstEnabledIndex >= 0) highlight(firstEnabledIndex);

  function dispose(): void {
    closeSubmenu();
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick);
    menuEl.remove();
    if (!options.isSubmenu) notifyOverlayClosed(dispose);
    options.onClose?.();
    options.returnFocusTo?.focus();
  }

  if (!options.isSubmenu) {
    openOverlay(dispose);
  }
  return dispose;
}

export { closeActiveOverlay as closeActiveMenu };
