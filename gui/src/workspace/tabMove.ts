// `tab.move`'s pre-removal `insert_index` semantics (spec phase1.5 §6):
//
// "`insert_index` is the drop slot in the tab list **before** the source is
// removed (0..=len): 'insert before the tab now at index i; len = end'. Move
// Left = i−1, and Move Right = i+2. A drag sends the caret slot directly."

/** Move Tab Left: `insert_index = i - 1`. May be negative at the leftmost
 * tab -- callers should check `canMoveLeft` first and skip the request. */
export function moveLeftInsertIndex(currentIndex: number): number {
  return currentIndex - 1;
}

/** Move Tab Right: `insert_index = i + 2`. May exceed the tab count at the
 * rightmost tab -- callers should check `canMoveRight` first. */
export function moveRightInsertIndex(currentIndex: number): number {
  return currentIndex + 2;
}

export function canMoveLeft(currentIndex: number): boolean {
  return currentIndex > 0;
}

export function canMoveRight(currentIndex: number, tabCount: number): boolean {
  return currentIndex < tabCount - 1;
}

/** A drag-and-drop caret slot (0..=len, "insert before the tab now at index
 * i") is already the `insert_index`, sent directly (spec: "A drag sends
 * the caret slot directly"). This identity function documents that fact at
 * the call site rather than hiding it. */
export function dragDropInsertIndex(caretSlot: number): number {
  return caretSlot;
}

/**
 * Computes the optimistic reordering of `tabIds` for a `tab.move` call
 * with `insertIndex` (spec §6 "reorder optimistically", finding #11):
 * "`insert_index` is the drop slot in the tab list *before* the source is
 * removed" -- so it is adjusted for the shift removing `tabId` causes
 * before splicing it back in at the resulting position. Returns `tabIds`
 * unchanged (a copy) if `tabId` isn't present.
 */
export function optimisticTabOrderAfterMove(
  tabIds: readonly string[],
  tabId: string,
  insertIndex: number,
): string[] {
  const fromIndex = tabIds.indexOf(tabId);
  if (fromIndex === -1) return [...tabIds];
  const withoutSource = tabIds.filter((id) => id !== tabId);
  const adjusted = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
  const clamped = Math.max(0, Math.min(withoutSource.length, adjusted));
  withoutSource.splice(clamped, 0, tabId);
  return withoutSource;
}
