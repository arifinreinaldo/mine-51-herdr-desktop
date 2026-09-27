// "Focus tab/workspace by index" (keyboard shortcuts: Alt+1..9 for tabs in
// the current workspace's tab strip order, Ctrl+Shift+1..9 for workspaces
// in sidebar order). 1-8 are fixed positions; 9 always means "the last one
// in the list", whatever its actual position -- so with 5 tabs, Alt+9 and
// Alt+5 resolve to the same tab.
//
// A pure function over `count` (the caller's own list length) rather than
// the list itself: the caller already has the ordered array (tab strip
// order already applies the optimistic reorder, sidebar order is just
// `snapshot.workspaces`) and only needs an index back to look the target
// up in it.

import { DIRECT_FOCUS_SLOT_COUNT } from "../shortcuts";

/** `Alt+9` / `Ctrl+Shift+9` -- always "the last one", never "the 9th one". */
export const LAST_FOCUS_SHORTCUT_DIGIT = 9;

/**
 * Resolves the shortcut digit `n` (1-9) to a 0-based index into a list of
 * `count` items, or `undefined` when the shortcut has nothing to focus:
 * `count === 0`, `n` outside 1-9, or a fixed position (1-8) beyond the
 * list's actual length.
 */
export function resolveIndexForShortcut(n: number, count: number): number | undefined {
  if (count === 0) return undefined;
  if (n === LAST_FOCUS_SHORTCUT_DIGIT) return count - 1;
  if (n < 1 || n > DIRECT_FOCUS_SLOT_COUNT) return undefined;
  const index = n - 1;
  return index < count ? index : undefined;
}
