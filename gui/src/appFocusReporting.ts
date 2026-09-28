// Terminal-parity spec P0 #3 "Focus reporting": keeps the GUI the
// foreground client (`ClientShellFocus`) on every DOM window focus/blur, so
// bell and OSC 52 keep reaching it
// (`src/server/headless/notifications.rs:325,338`). The reconnect loop
// separately sends one more right after each (re)connect
// (`dispatch::run_reconnect_loop`), covering a reattach that happens while
// the window is already focused.

import { invokeSafe } from "./appApi";
import { appState } from "./appState";

export function wireFocusReporting(): void {
  window.addEventListener("focus", () => {
    appState.windowFocused = true;
    void invokeSafe("set_client_focus", { focused: true });
  });
  window.addEventListener("blur", () => {
    appState.windowFocused = false;
    void invokeSafe("set_client_focus", { focused: false });
  });
}
