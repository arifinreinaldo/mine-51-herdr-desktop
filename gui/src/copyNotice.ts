// The transient "Copied" toast shown for both clipboard-write paths: mouse-
// selection auto-copy (`appTerminalMouse.ts`, after `pane.selection.read`)
// and OSC 52 passthrough (`main.ts`'s `clipboard-copied` listener, fired by
// `dispatch::handle_clipboard` in the Rust backend). One function so both
// paths show the exact same notice instead of drifting into two.
//
// A copy that follows a mouse release shows the toast next to the pointer,
// where the user is looking; a bottom-centre toast was easy to miss.

import { copyNoticeEl } from "./appDom";

const COPY_NOTICE_DURATION_MS = 2000;
/** A pointer release older than this did not cause the copy (OSC 52, keys). */
const POINTER_ANCHOR_MAX_AGE_MS = 2000;

let hideTimer: number | undefined;
let lastPointerUp: { x: number; y: number; at: number } | null = null;

document.addEventListener(
  "pointerup",
  (event) => {
    lastPointerUp = { x: event.clientX, y: event.clientY, at: performance.now() };
  },
  true,
);

export function showCopiedNotice(): void {
  copyNoticeEl.textContent = "Copied";
  const anchor =
    lastPointerUp && performance.now() - lastPointerUp.at < POINTER_ANCHOR_MAX_AGE_MS ? lastPointerUp : null;
  copyNoticeEl.classList.toggle("is-at-pointer", anchor !== null);
  copyNoticeEl.style.left = anchor ? `${anchor.x}px` : "";
  copyNoticeEl.style.top = anchor ? `${anchor.y - 36}px` : "";
  copyNoticeEl.classList.add("is-visible");
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = undefined;
    copyNoticeEl.classList.remove("is-visible");
  }, COPY_NOTICE_DURATION_MS);
}
