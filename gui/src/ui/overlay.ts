// Shared "one overlay open at a time" coordinator: menus, confirm
// popovers, and hover popovers (usage/agents) all register here so opening
// one closes whatever else was open, and a single Esc handler can close
// whichever is active. Submenus are *not* separately registered here --
// they're owned by their parent menu's own lifecycle (see `menu.ts`).

export interface OpenOverlayOptions {
  /** Whether Esc typed while focus is elsewhere (e.g. the terminal capture)
   * may close this overlay via the central keyboard router (`keyboard/
   * routing.ts`). Defaults to `true`. UX pass 1 spec §3 finding #3: a
   * pinned agent popover must never swallow an Esc typed in the terminal --
   * only an Esc typed while focus is actually inside it may close it, and
   * that path is the popover's own keydown listener, not this one. */
  escapableFromOutside?: boolean;
  /** Runs once, the next time the overlay stack actually empties (some
   * overlay closes with nothing else open) -- but only when *this* overlay
   * was closed because a *different* overlay opened over it (superseded);
   * never for any other close reason (Esc, an outside click, this
   * overlay's own toggle/button). UX pass 1 spec §3 "Pinnable agent list" /
   * finding #5: lets a pinned agent popover reopen once whatever bumped it
   * (a menu, a hover popover, a confirm) itself finishes closing, instead
   * of just vanishing for good. */
  onSupersededReopen?: () => void;
}

interface OverlayEntry {
  dispose: () => void;
  escapableFromOutside: boolean;
  onSupersededReopen?: () => void;
}

let active: OverlayEntry | null = null;
/** Armed by `openOverlay` when it supersedes an entry that asked for
 * `onSupersededReopen`; fired the next time the stack empties for real
 * (see `fireDeferredReopen`), whether that happens via `closeActiveOverlay`
 * or the newer overlay's own `notifyOverlayClosed`. */
let deferredReopen: (() => void) | null = null;

function fireDeferredReopen(): void {
  if (deferredReopen) {
    const reopen = deferredReopen;
    deferredReopen = null;
    reopen();
  }
}

/** Closes the currently active top-level overlay, if any. */
export function closeActiveOverlay(): void {
  if (active) {
    const dispose = active.dispose;
    active = null;
    dispose();
    fireDeferredReopen();
  }
}

export function isOverlayOpen(): boolean {
  return active !== null;
}

/** Whether the currently active overlay (if any) may be closed by an Esc
 * typed while focus is elsewhere -- see `OpenOverlayOptions.
 * escapableFromOutside`. `true` (the permissive default) when nothing is
 * open, so callers don't need to `isOverlayOpen()`-guard first. */
export function isActiveOverlayEscapableFromOutside(): boolean {
  return active?.escapableFromOutside ?? true;
}

/** Registers `dispose` as the active overlay, closing whatever was open
 * before it. The caller must call `notifyOverlayClosed(dispose)` from
 * inside its own disposer so this tracker doesn't hold a stale reference. */
export function openOverlay(dispose: () => void, options: OpenOverlayOptions = {}): void {
  if (active) {
    const prev = active;
    active = null;
    // Finding #5: `prev` is being superseded by the overlay opening below,
    // not naturally closing -- arm its reopen (if it asked for one) rather
    // than firing it now, so it fires once the *new* overlay itself later
    // closes with nothing left open.
    if (prev.onSupersededReopen) deferredReopen = prev.onSupersededReopen;
    prev.dispose();
  }
  active = {
    dispose,
    escapableFromOutside: options.escapableFromOutside ?? true,
    onSupersededReopen: options.onSupersededReopen,
  };
}

export function notifyOverlayClosed(dispose: () => void): void {
  if (active?.dispose === dispose) {
    active = null;
    fireDeferredReopen();
  }
}
