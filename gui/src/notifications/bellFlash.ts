// `ServerMessage::TerminalBell{count}` (terminal-parity spec P1 #13 "Bell
// and notifications"): flashes the currently focused tab for 200ms. The
// message carries no `pane_id` (only a count), so "the tab" is the
// currently focused one -- the only one this GUI client (the foreground
// client, `src/server/headless/notifications.rs:325`) could plausibly mean.
// The window-unfocused taskbar flash is handled entirely in Rust
// (`notify::handle_terminal_bell`); this is only the in-app pulse.

import { tabListEl } from "../appDom";
import { appState } from "../appState";

const FLASH_DURATION_MS = 200;
const FLASH_CLASS = "tab-bell-flash";

export function flashFocusedTab(): void {
  const tabId = appState.snapshot?.focused_tab_id;
  if (!tabId) return;
  const tabEl = tabListEl.querySelector<HTMLElement>(`.tab[data-tab-id="${CSS.escape(tabId)}"]`);
  if (!tabEl) return;
  tabEl.classList.add(FLASH_CLASS);
  window.setTimeout(() => tabEl.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
}
