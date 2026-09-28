// The transient "Copied" toast shown for both clipboard-write paths: mouse-
// selection auto-copy (`appTerminalMouse.ts`, after `pane.selection.read`)
// and OSC 52 passthrough (`main.ts`'s `clipboard-copied` listener, fired by
// `dispatch::handle_clipboard` in the Rust backend). One function so both
// paths show the exact same notice instead of drifting into two.

import { copyNoticeEl } from "./appDom";

const COPY_NOTICE_DURATION_MS = 1500;

let hideTimer: number | undefined;

export function showCopiedNotice(): void {
  copyNoticeEl.textContent = "Copied";
  copyNoticeEl.classList.add("is-visible");
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = undefined;
    copyNoticeEl.classList.remove("is-visible");
  }, COPY_NOTICE_DURATION_MS);
}
