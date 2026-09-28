# herdr GUI — terminal parity spec (from the feature audit)

Status: READY for P0 and P1 (the P2 items are listed; they are built only on request).
Source: a read-only audit of `gui/` against herdr's server and TUI client.
Nothing outside `gui/` changes. The mouse selection, wheel and clipboard work lands
first in its own pass.

## Facts that shape the design (verified in herdr source)

- **The server handles input.** `src/server/pane_input.rs:217-345` handles every
  `ClientShellPaneInput`. It encodes keys per pane mode, including the kitty keyboard
  protocol (:309). It adds bracketed paste to `Paste` (:327), and it calls
  `scroll_reset` on key, text or paste. It routes the wheel to scrollback, to the
  app's mouse reporting, or to alternate scroll (:128-185), and plain PgUp/PgDn at
  a shell prompt scroll the scrollback (:293-309).
- **Only the foreground client gets bell and OSC 52** (`headless/notifications.rs:325,338`).
  A client becomes foreground again through `ClientShellFocus{true}`
  (`headless.rs:2241`).
- **The client draws copy mode and find.** The server only computes
  `pane.copy_motion` / `pane.copy_search` (`response.rs:169-183`); the TUI draws
  the rest (`copy_mode.rs`).
- **Link handling:** `pane.link.activate {pane_id, viewport_row, col,
  content_revision, offset_from_bottom}` returns `{url?, handled}`. When `handled` is
  false, the client opens the URL after a `safe_web_url` check
  (`actions.rs:685-697`, `shell_runtime.rs:41-50`). `pane.link.resolve` takes the
  same params and returns `{regions}` for hover.

## P0 — daily use

1. **Ctrl+Shift+C = Copy.** Claim it in `shortcuts.ts`, so it never reaches the pane
   (today it is sent as Ctrl+Shift+'c', `keymap.ts:127-132`). Keep the last
   selection (pane id, anchor, cursor, `content_revision`) after mouse release,
   leaving the highlight visible until the next click or input, and copy with
   `pane.selection.read`. With no selection, do nothing.
2. **AltGr.** On Windows, AltGr sets `ctrlKey` and `altKey`. When
   `event.getModifierState("AltGraph")` is true, or when Ctrl+Alt produces a
   printable non-ASCII-letter key, send `TextCommit(key)` rather than a Ctrl+Alt key
   (`keymap.ts:127`). Test with German `AltGr+Q = @` and Polish `AltGr+A = ą`.
3. **Focus reporting.** Send `ClientShellFocus{focused}` on window focus and blur
   (Tauri window events), and once after connect. This keeps the GUI the foreground
   client, so bell and OSC 52 keep reaching it.
4. **Paste.**
   - Shift+Insert = Paste, claimed in the capture layer.
   - A Rust `clipboard_read_text` command, using the clipboard crate the mouse pass
     added, replaces `navigator.clipboard.readText`.
   - Paste always goes through `Paste(text)`, so the server adds bracketed paste.
5. **Terminal right-click menu.**
   - **Follow the TUI rule** (`mouse.rs:1755-1835`): a right-click goes to the app
     only if the pane has `mouse_reporting` AND
     (`ClientShellPane.right_click_passthrough` with no modifiers, or the
     passthrough modifiers match).
   - **Otherwise, open a GUI menu:** Copy (when there is a selection), Paste, Select
     All, Clear, then Split Right / Split Down, Zoom, then "Send right-clicks to pane"
     (a toggle, `pane.input.set {pane_id, right_click}`), then Close Pane.
   - It uses the existing `ui/menu.ts` and explicit pane ids.
6. **Links.**
   - **Ctrl+click** (Left down with Ctrl) → `pane.link.activate`. If `handled` is
     false and `url` is http(s), open it with the opener plugin from Rust (validate
     the scheme: http/https only, no `file:`, and no `javascript:`).
   - **Ctrl+hover** → `pane.link.resolve`, throttled to one call per 100 ms: draw an
     underline over the returned regions and use a pointer cursor.

## P1

7. **Find in scrollback (Ctrl+Shift+F).**
   - A small find bar docked at the top-right of the pane, with a query box,
     Enter/Shift+Enter for next/previous, a "3/17" count, and Esc to close.
   - It calls `pane.copy_search {pane_id, query, direction, cursor, content_revision,
     previous?}`.
   - It scrolls to the match with `pane.scroll` and highlights the current match on
     the client.
8. **Copy mode (Ctrl+Shift+Space).**
   - The keys follow the TUI (`copy_mode.rs`): hjkl/arrows, w/b/e, 0/$, g/G, v to
     select, y or Enter to copy, and Esc to exit.
   - Motions go through `pane.copy_motion`.
   - The client draws the cursor, the selection and a mode badge. Copy uses
     `pane.selection.read`.
9. **Double-click word, triple-click line** (350 ms / ±1 cell, as in
   `word_selection.rs:62-140`, `state.rs:765`).
   - A word = `pane.selection.read` of the row, with the bounds found on the client
     using the same word rules as `app::actions::word_bounds_at_column`.
   - A line = the whole row.
   - Both auto-copy the same way as a drag selection.
10. **Scrollback keys.**
    - Shift+PgUp/PgDn scroll by one page, and Shift+Home/End go to the top and
      bottom, through `pane.scroll {pane_id, offset_from_bottom}`, using
      `PaneSurfacePane.scroll` and `viewport_rows`.
    - Dragging the scrollbar thumb within `scrollbar_rect` → `pane.scroll`.
11. **Shift+drag over mouse-reporting apps** selects instead of forwarding to the
    app. Shift+wheel is left to the app.
12. **Clear:** the context menu, plus Pane ▸ Clear (Ctrl+Shift+K) → `pane.clear`.
13. **Bell and notifications.** Handle `ServerMessage::TerminalBell{count}`: flash
    the tab (a 200 ms background pulse); if the window is unfocused, also call
    `request_user_attention(Informational)`. There is no sound, so the bell never
    becomes annoying. Handle `SemanticNotification` as a second source for the done
    toast, de-duplicated against the snapshot detector by pane id and seq.
14. **Drag and drop files.** Tauri `onDragDropEvent` over the terminal pastes the
    dropped paths into the pane under the pointer, each quoted for PowerShell (`'…'`,
    with inner `'` doubled) and separated by spaces. It uses `Paste`, not typed keys.
15. **Rendering.**
    - Add a cursor shape byte to the frame format, using DECSCUSR values from
      `CursorState.shape` (`wire.rs:751-764`): block, underline, or bar, plus a blink
      flag. Encoder, decoder, golden files and renderer all change; the old golden
      files keep decoding.
    - Render strikethrough (bit 8), hidden (bit 7), and the underline style nibble
      (bits 12-15: single, double, curly, dotted, dashed).
    - Honour blink on the cursor only; blinking text is P2.
16. **IME:** position the hidden textarea at the cursor cell, so the candidate
    window appears next to the cursor.

## P2 (on request)

- Kitty report-all: key release and repeat when `ClientShellKeyboardReportAll{enabled}`.
- Image paste: `ClientMessage::ClipboardImage{target: Pane(id), extension, data}`
  (`wire.rs:488`).
- A multi-line paste confirmation (GUI-only).
- `WindowTitle` → the window title.
- `pane.edit_scrollback`.
- Blinking text.
- Kitty graphics.
- Per-pane OSC titles for non-agent panes **need a herdr server change**
  (`ClientShellPane` has no title field).

## Tests

For every item: unit tests of the pure logic (key routing, AltGr, the passthrough
rule, word bounds, the scroll maths, path quoting, the frame-format cursor byte with
old and new golden files, the URL scheme filter). Add jsdom tests for the menu, the
find bar and the copy-mode keys. `npm run check` stays green.
