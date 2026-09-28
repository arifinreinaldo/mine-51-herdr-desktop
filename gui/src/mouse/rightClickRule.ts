// The right-click forward-to-app rule (terminal-parity spec P0 #5), ported
// from herdr's TUI client's own `handle_mouse` (`src/client/shell/mouse.rs:
// 1762-1780`): `pane_owns_right_click = pane.right_click_passthrough &&
// mouse.modifiers.is_empty()`, then forward only when `hit.mouse_reporting
// && (pane_owns_right_click || configured_modifiers.is_some())`.
//
// The GUI has no local `config.toml` of its own -- `right_click_passthrough_
// modifiers` (the `configured_modifiers` half of that `||`) is a TUI-only
// setting read from `self.config` (`src/client/shell/config.rs:152`), never
// sent over the wire -- so this port is the TUI rule with that half
// permanently `false`: only `right_click_passthrough` (from the snapshot's
// `ClientShellPane`, spec fact "herdr's TUI client's own... rule") and an
// empty modifier set decide it here.
export function shouldForwardRightClickToApp(mouseReporting: boolean, rightClickPassthrough: boolean, modifiers: number): boolean {
  return mouseReporting && rightClickPassthrough && modifiers === 0;
}
