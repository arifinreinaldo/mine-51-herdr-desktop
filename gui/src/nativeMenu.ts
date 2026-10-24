// Pure conversion of the in-window menu items (`ui/menus.ts`) into the
// native macOS menu bar payload for the Rust `set_native_menu` command. The
// in-window menus stay the single source of items, labels, checks and actions.

import type { MenuItemSpec } from "./ui/menu";

export interface NativeItem {
  id: string;
  label: string;
  accelerator?: string;
  checked?: boolean;
  enabled: boolean;
  separatorBefore: boolean;
  submenu: NativeItem[];
}

export interface NativeMenu {
  title: string;
  items: NativeItem[];
}

const MODIFIERS: Readonly<Record<string, string>> = { "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift", "⌘": "Cmd" };
const KEYS: Readonly<Record<string, string>> = { Return: "Enter", "←": "Left", "→": "Right", "↑": "Up", "↓": "Down" };
const PUNCTUATION = new Set(["[", "]", "/", ",", "=", "-", "`"]);

/** `"⇧⌘W"` -> `"Shift+Cmd+W"`-style accelerator (`"Cmd+Shift+W"`). Only combos
 * with ⌘ qualify: those are the ones the page claims itself, so showing them in
 * the menu cannot make the menu steal a key the terminal needs. Aliases
 * (`"⇧⌘] / ⌃Tab"`) use the first combo. `null` when it cannot be expressed. */
export function glyphToAccelerator(display: string | undefined): string | null {
  if (!display) return null;
  const first = display.split(" / ")[0].trim();
  const mods: string[] = [];
  let rest = first;
  while (rest.length > 0 && MODIFIERS[rest[0]]) {
    mods.push(MODIFIERS[rest[0]]);
    rest = rest.slice(1);
  }
  if (!mods.includes("Cmd")) return null;
  const key = KEYS[rest] ?? (/^[A-Z0-9]$/.test(rest) || PUNCTUATION.has(rest) ? rest : null);
  if (!key) return null;
  const order = ["Cmd", "Ctrl", "Alt", "Shift"];
  return [...order.filter((m) => mods.includes(m)), key].join("+");
}

function convert(
  items: readonly MenuItemSpec[],
  prefix: string,
  handlers: Map<string, () => void>,
): NativeItem[] {
  return items.map((item, index) => {
    const id = `${prefix}.${index}`;
    const submenu = item.submenu ? convert(item.submenu, id, handlers) : [];
    if (submenu.length === 0 && item.onSelect) handlers.set(id, item.onSelect);
    const native: NativeItem = {
      id,
      label: item.label,
      enabled: !item.disabled,
      separatorBefore: Boolean(item.separatorBefore),
      submenu,
    };
    const accelerator = glyphToAccelerator(item.shortcut);
    if (accelerator) native.accelerator = accelerator;
    if (item.checked !== undefined) native.checked = item.checked;
    return native;
  });
}

/** `menus` in menu-bar order. `handlers` maps each clickable item's id to its
 * action; the Rust side reports clicks by that id. */
export function toNativeMenus(
  menus: readonly { name: string; title: string; items: readonly MenuItemSpec[] }[],
): { spec: NativeMenu[]; handlers: Map<string, () => void> } {
  const handlers = new Map<string, () => void>();
  const spec = menus.map((menu) => ({ title: menu.title, items: convert(menu.items, menu.name, handlers) }));
  return { spec, handlers };
}
