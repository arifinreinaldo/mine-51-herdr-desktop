// File viewer spec §7.1: the double tap on Shift that opens Find File. Pure state;
// `keyboard/routing.ts` feeds it from its capture-phase listeners.
// shortcut: a fixed 400 ms window; make it a setting if fast typists misfire (spec §10).
export const DOUBLE_SHIFT_WINDOW_MS = 400;
export type ShiftKeyLike = Pick<KeyboardEvent, "code" | "repeat" | "ctrlKey" | "altKey" | "metaKey">;
export interface DoubleShiftTracker {
  /** `true` when this keydown completes a double tap. */
  keydown(event: ShiftKeyLike, now: number): boolean;
  keyup(event: ShiftKeyLike, now: number): void;
  /** A mouse button or a wheel turn between the taps. */
  cancel(): void;
}
function isShift(event: ShiftKeyLike): boolean {
  return event.code === "ShiftLeft" || event.code === "ShiftRight";
}
export function createDoubleShiftTracker(windowMs = DOUBLE_SHIFT_WINDOW_MS): DoubleShiftTracker {
  let downAt: number | null = null; // tap 1: Shift down since
  let upAt: number | null = null; // tap 1 ended at
  const cancel = (): void => { downAt = null; upAt = null; };
  return {
    keydown(event, now) {
      if (isShift(event) && event.repeat) return false; // a held Shift; keyup checks the hold time
      // On a Shift keydown shiftKey is already true: only Ctrl, Alt and Meta are "other modifiers".
      if (!isShift(event) || event.ctrlKey || event.altKey || event.metaKey) { cancel(); return false; }
      if (upAt !== null && now - upAt <= windowMs) { cancel(); return true; }
      downAt = now;
      upAt = null;
      return false;
    },
    keyup(event, now) {
      if (!isShift(event) || downAt === null) return;
      upAt = now - downAt <= windowMs ? now : null;
      downAt = null;
    },
    cancel,
  };
}
