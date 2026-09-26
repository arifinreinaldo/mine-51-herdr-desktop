// Shared "one overlay open at a time" coordinator: menus, confirm
// popovers, and hover popovers (usage/agents) all register here so opening
// one closes whatever else was open, and a single Esc handler can close
// whichever is active. Submenus are *not* separately registered here --
// they're owned by their parent menu's own lifecycle (see `menu.ts`).

let activeDispose: (() => void) | null = null;

/** Closes the currently active top-level overlay, if any. */
export function closeActiveOverlay(): void {
  if (activeDispose) {
    const dispose = activeDispose;
    activeDispose = null;
    dispose();
  }
}

export function isOverlayOpen(): boolean {
  return activeDispose !== null;
}

/** Registers `dispose` as the active overlay, closing whatever was open
 * before it. The caller must call `notifyOverlayClosed(dispose)` from
 * inside its own disposer so this tracker doesn't hold a stale reference. */
export function openOverlay(dispose: () => void): void {
  closeActiveOverlay();
  activeDispose = dispose;
}

export function notifyOverlayClosed(dispose: () => void): void {
  if (activeDispose === dispose) activeDispose = null;
}
