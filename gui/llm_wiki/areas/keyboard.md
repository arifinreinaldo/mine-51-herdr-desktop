# Keyboard and shortcuts

## Purpose
One capture-phase router sends every key. It checks the shortcut table, then the terminal, then chrome widgets.

## Key files
- `src/keyboard/routing.ts` - `routeKeydown` (line 86), `routeKeyup` (line 196), `installKeyboardRouting` (line 203). Handler contract: lines 55-69.
- `src/keyboard/doubleShift.ts` - double-Shift tracker, window `DOUBLE_SHIFT_WINDOW_MS` = 400 (line 4).
- `src/keyboard/focusCapture.ts` - `#keyboard-capture` focus helpers (lines 19, 35, 45).
- `src/shortcuts.ts` - the shortcut table. `ShortcutAction` (line 33), `matchesCombo` (line 514), `findShortcut` (line 529), `shortcutDisplay` (line 502).
- `src/input/keymap.ts` - `mapKeyboardEvent` (line 105) maps a key to the wire key. `macCmdTextKey` (line 147) and `altGrTextCommit` (line 174) handle special cases.
- `src/appMenuBar.ts` - `onShortcut` runs a claimed action (line 436).
- `src/main.ts:159` - passes `onDoubleShift: openFindFile`.

## Flow
1. Skip IME input (`src/keyboard/routing.ts:92`).
2. Feed the double-Shift tracker first. It fires `onDoubleShift` unless focus is in a text field or a non-escapable overlay is open (`src/keyboard/routing.ts:99-100`).
3. Match the shortcut table. Otherwise forward to the terminal if `#keyboard-capture` has focus.
4. A pointer or wheel event cancels a pending double-Shift (`src/keyboard/routing.ts:211-215`).

## macOS
- `IS_MAC` reads the user agent (`src/shortcuts.ts:495`).
- `buildMacShortcuts` maps the Windows table to Cmd combos (`src/shortcuts.ts:474`). `MAC_ENTRIES` holds the map (line 416).
- `view.sourceControl` is Cmd+Shift+G on macOS (`src/shortcuts.ts:450`).
- Unit tests always use the Windows table because Node has no "Macintosh" agent (`src/shortcuts.ts:493-494`).

## Edges
- Find File has no table entry. Only double-Shift opens it. Ctrl+F and Cmd+F inside the viewer open the viewer find bar (`src/appFiles.ts:184-186`).
- A text field keeps its Shift taps. Do not remove the `inTextField` guard (`src/keyboard/routing.ts:98`).
- Tests: `tests/unit/keyboard/`, `tests/unit/keymap.test.ts`.
- Shortcut marker: [[shortcut-markers]] (fixed 400 ms window).
