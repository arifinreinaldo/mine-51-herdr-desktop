# herdr GUI — Phase 1.5 spec: VS Code-style shell

Status: v2 (Opus, revised after the Fable review: 1 blocker, 6 major, 8 minor
applied), plus a renderer performance section (§8a).
Builds on Phase 1 (`gui/docs/phase1-spec.md` v3). Everything in Phase 1 §8
("Do NOT touch") and its safety rules still applies.

## 0. Goal and success criterion

Make the GUI look and behave like the approved mockup, with a VS Code-style shell
(custom title bar and menus, workspace sidebar, editor-style tabs, and a status bar),
VS Code theme import, agent-done notifications, and a crisp terminal renderer.

**Visual reference (approved by the user):** `gui/docs/mock/index.html` (open it
with `?state=a|b|c`) and `mock-a.png`, `mock-b.png`, `mock-c.png`,
`ws-close-zoom.png`. Sizes, colours, and states in this spec come from that mockup.
If this text and the mockup disagree, this text wins. Report the conflict.

Phase 1.5 is **done** when:

1. `cd gui && npm run check` exits 0, three runs in a row.
2. The **polish checklist** (§11) passes on screenshots of the live app against the
   `gui-test` session, taken by the main session.
3. The live behaviours in §12 work against the `gui-test` session.

## 1. Settled decisions (user-approved, do not reopen)

- Default theme = VS Code **Dark Modern** (the mockup colours). The other themes
  are built in or imported.
- **Custom HTML menu bar**, not the native menu. Native Windows menus are always
  light Win32 (tauri-apps/muda#97), so they cannot follow the theme. Every keyboard
  shortcut goes through the existing single key-capture path
  (`#keyboard-capture` → `gui/src/input/keymap.ts`).
- **Keys the GUI claims.** Only the shortcuts listed in §4 are claimed, and they
  are all `Ctrl+Shift+*`, `Alt+Shift+*`, `Ctrl+Tab`/`Ctrl+Shift+Tab`,
  `Ctrl+=`/`-`/`0`, `F2` (only when a tab has UI focus, never when the terminal
  has focus), or `Ctrl+,`. **Every other key goes to the terminal.** Plain
  `Ctrl+T` in particular belongs to Claude Code ("toggle task checklist"), bash,
  and PSReadLine. `Ctrl+Shift+C`/`Ctrl+Shift+V` stay reserved for a future copy
  and paste.
- **WebView2 browser keys are disabled** so they reach the terminal. F5, F3, F7,
  Ctrl+F/P/R, and Ctrl+Shift+I never reach JS by default, and F5 would reload the
  GUI. Use `tauri-plugin-prevent-default` (feature `platform-windows`,
  `.browser_accelerator_keys(false)`). Set `"zoomHotkeysEnabled": false`
  explicitly. Match symbol keys by `event.code` (`Equal`, `Minus`, `Digit0`),
  because Shift and Alt change `event.key`.
- **Keyboard routing.** One `document` capture-phase `keydown` listener handles
  every key, in this order:
  1. Skip if `isComposing || keyCode===229` (IME).
  2. Check the `shortcuts.ts` table.
  3. If `activeElement` is `#keyboard-capture` → keymap → terminal.
  4. Otherwise, chrome keys (F2, Shift+F10, arrows, Enter, Esc) act on the focused
     element.

  "Tab UI focus" means `activeElement` is a `.tab`, reached with the Tab key or a
  right-click. A left click on a tab returns focus to the capture.
- **New tab** = `Ctrl+Shift+T` → `tab.create {workspace_id, focus:true}` with
  `cwd` **omitted**. The server then applies its own cwd policy, which is the
  focused pane's tracked cwd on Windows (`src/app/api/tabs.rs:47-64`,
  `src/app/creation.rs:30-45`). **Counterintuitive:** do not compute a cwd on the
  client. `foreground_cwd` is always `None` on Windows (`src/pane.rs:3629`).
- **New workspace** = a native folder picker **called from Rust**
  (`tauri-plugin-dialog`, `app.dialog().file().blocking_pick_folder()` inside a
  Tauri command). The command must be an `async fn`, because
  `blocking_pick_folder` must not run on the main thread. The webview gets **no**
  `dialog:*` permission. The command returns the path, and the frontend then calls
  `workspace.create {cwd, label: <folder basename>, focus:true}`. Passing `label`
  sets a custom name (`custom_label:true`), so the name stops following the
  branch. That is intended.
- **Duplicate folder:** if the chosen folder is already a workspace, focus that
  workspace instead. `new_workspace_cwd` is **not** the workspace root: it is the
  active pane's current cwd after the `new_terminal_cwd` policy
  (`src/app/creation.rs:10-28,90-101`). Match in this order:
  1. Match a persisted `{workspace_id → folder}` map, kept in settings.json for
     GUI-created workspaces and pruned against the snapshot.
  2. Otherwise, dedup only when **exactly one** workspace's normalized
     `new_workspace_cwd` equals the folder **and** no two workspaces share that
     value.
  3. Otherwise, create a new workspace.

  The comparison lives in TS, together with its tests. Compare the paths
  normalized: case-insensitive on Windows, `/` equal to `\`, and trailing
  separators stripped.
- **Close workspace:** there is no menu item. A subtle `×` appears on the sidebar
  row on hover and turns red when the pointer is on it. Clicking it opens an
  inline **confirmation popover** that names the workspace and counts its running
  and blocked agents.
- **Close tab:** the tab `×`, with **no confirmation**. Middle-click also closes.
- **Pane actions always name their pane.** Snapshot `focused_*` ids are per
  connection (`src/server/client_shell.rs:37-57`). A pane method called without a
  pane id resolves to the **server-global** active pane, which is the TUI's
  (`src/app/api/panes.rs:1992-2001`). Always send `pane.split {direction,
  focus:true, target_pane_id}`, `pane.zoom {pane_id}`, and `pane.close {pane_id}`.
  The pane is `snapshot.focused_pane_id`. **(v3 correction)** For the tab context
  menu on an **inactive** tab, `snapshot.panes[].focused` cannot help: it is true
  only for the connection-focused pane (`src/server/client_shell.rs:129`). Instead,
  run `tab.focus` and await it. Then wait (≤ 2 s) for a snapshot with
  `focused_tab_id === tabId`, and use its `focused_pane_id`. On a timeout, show a
  notice. Fix the same latent bug in
  the Phase 1 toolbar code while replacing it.
- **Split Right / Split Down** live in the **tab's menu** (right-click on the tab).
  They also appear in the `Pane` menu with shortcuts. The tab strip has no split
  icons.
- **Agent status** lives at the bottom left of the status bar, as counts with
  status colours. A click opens the agent list popover. The sidebar has **no**
  agents section.
- **Agent done notification:**
  - When an agent transitions to **Done**, the agent popover opens by itself with
    that row highlighted (green glow, "DONE · just now", Enter jumps to it). It
    hides after 8 s unless the pointer hovers it.
  - If the window is **not focused**, the app also flashes the taskbar and shows a
    Windows desktop toast through `tauri-plugin-notification`, called from Rust.
    It is never both the toast and the popover while the window is focused.
  - A setting turns the toast off.
- **Usage component:**
  - Always visible: the 5-hour meter with `NN% · XhYYm left`.
  - Hover or focus opens a popover with the 5-hour and weekly bars, `%`, the
    reset time in local time, and "as of N m ago".
- **herdr menu** in the menu bar mirrors the TUI global menu
  (`src/client/shell/global_menu.rs:22-50`): Settings…, Keyboard Shortcuts,
  Reload Config, What's New / Update Ready, and Detach. A dot on the menu title
  = `update_available || integration_updates_available`
  (`global_menu.rs:9-11`). "What's New" appears when `update_available ||
  latest_release_notes_available`, and it is inert when `release_notes` is None
  (`global_menu.rs:39-48,92-100`).

## 2. Theme system

### 2.1 Tokens

The theme is a flat map of **VS Code colour keys** to CSS colours. The loader
writes each key to `:root` as a CSS custom property with every `.` replaced by `-`.
For example, `sideBar.background` becomes `--sideBar-background`. CSS reads only
these variables. **No hard-coded colours in CSS or TS**, apart from the built-in
theme tables.

Required keys, each with a Dark Modern fallback. Take the values from the mockup
`:root` in `gui/docs/mock/index.html`, or from the VS Code Dark Modern source:

- **Title bar and menus:** `titleBar.activeBackground`,
  `titleBar.activeForeground`, `titleBar.inactiveBackground`, `menu.background`,
  `menu.foreground`, `menu.selectionBackground`, `menu.selectionForeground`,
  `menu.separatorBackground`, `menu.border`
- **Sidebar and lists:** `sideBar.background`, `sideBar.border`,
  `sideBarSectionHeader.foreground`, `list.hoverBackground`,
  `list.activeSelectionBackground`, `list.activeSelectionForeground`,
  `list.inactiveSelectionBackground`, `list.focusOutline`
- **Text and focus:** `foreground`, `descriptionForeground`, `icon.foreground`,
  `focusBorder`, `errorForeground`
- **Tabs:** `editorGroupHeader.tabsBackground`, `tab.activeBackground`,
  `tab.activeForeground`, `tab.inactiveBackground`, `tab.inactiveForeground`,
  `tab.hoverBackground`, `tab.activeBorderTop`, `tab.border`,
  `tab.dragAndDropBorder`
- **Terminal:** `terminal.background` (falls back to `editor.background`),
  `terminal.foreground`, `terminalCursor.foreground`,
  `terminal.selectionBackground`, and the 16 `terminal.ansi*` keys (`ansiBlack` …
  `ansiBrightWhite`)
- **Status bar and hover widgets:** `statusBar.background`,
  `statusBar.foreground`, `statusBar.border`, `statusBarItem.hoverBackground`,
  `statusBarItem.warningBackground`, `statusBarItem.errorBackground`,
  `editorHoverWidget.background`, `editorHoverWidget.border`
- **Sashes, progress, buttons, and charts:** `sash.hoverBorder`,
  `progressBar.background`, `button.background`, `button.foreground`,
  `charts.blue`, `charts.orange`, `charts.green`
- **herdr keys:**
  - `herdr.status.working` → `charts.blue`
  - `herdr.status.blocked` → `charts.orange`
  - `herdr.status.done` → `charts.green`
  - `herdr.status.idle` → `descriptionForeground`
  - `herdr.danger` → `#c72e0f`, used for the close-hover state and destructive
    buttons

A missing key falls back first along the chain above, then to Dark Modern.

### 2.2 Built-in themes

`gui/src/themes/*.ts`: **Dark Modern (default)**, **herdr** (near-black with a
peach active tab), **Catppuccin Mocha**, **Tokyo Night**, **One Dark Pro**, and
**Dracula**. The approximate token values are in the `THEMES` table in the mockup
script. Complete the ansi keys from each theme's published palette.

### 2.3 Import

- **Menu:** View ▸ Import VS Code Theme…. A Rust command opens a file dialog for
  `*.json` or `*.vsix`.
- **`.vsix`:** a zip archive (`zip` crate). Read `extension/package.json`, then
  `contributes.themes[]`: `{label, uiTheme, path}`. A `.vsix` can hold several
  themes. Import all of them.
- **Theme JSON is JSONC.** It can contain comments and trailing commas. Parse it
  with a JSONC-tolerant parser, such as the `json5` crate or an equivalent, and
  state the choice.
- **`include`:** resolve `"include": "./base.json"` relative to the file, inside
  the vsix or on disk. The child overrides the parent. Allow depth ≤ 5 and detect
  cycles.
- **Theme type:** it usually comes from the vsix `uiTheme`: `vs` → light, `vs-dark`
  → dark, `hc-*` → hc. Use the JSON `type` only if it is present.
- **Use only `colors`**, plus `name`. Ignore
  `tokenColors` and `semanticTokenColors` in Phase 1.5 (the Monaco phase uses
  them).
- **Stored** at `%APPDATA%\herdr-gui\themes\<slug>.json`, normalized to
  `{name, type, colors}`.
- **Limits:** reject files > 5 MB, reading through `Read::take(5 MiB)` because the
  declared sizes can lie. Reject a vsix with > 2000 entries. Use
  `ZipFile::enclosed_name()`, and reject anything else (zip-slip). Keys must match
  `^[A-Za-z0-9.]+$`, with ≤ 2000 keys, and are applied through
  `style.setProperty`, never a `<style>` string. Reject and colour values that are not `#rgb`, `#rgba`, `#rrggbb`, or
  `#rrggbbaa`. Skip those keys and count them in an import report shown as a
  transient notice.

### 2.4 Picker

View ▸ Color Theme ▸ lists the built-in themes, then the imported ones, with a
check mark on the current one. Choosing a theme applies it **live** with no
reload and persists the choice.

## 3. Layout (sizes from the mockup)

```
┌ title bar 30px: [logo] Workspace Tab Pane Agents View herdr● Help   <title>   [─][□][×] ┐
│ sidebar 260px (180–400) │ tab strip 35px                                              │
│  WORKSPACES   [new][…]  │ ─────────────────────────────────────────────────────────── │
│  ● name        (× hover)│ terminal canvas (8px inset)                                 │
│    ⎇ branch ↑a ↓b       │                                                             │
│  ...                    │                                                             │
│  + New Workspace…       │                                                             │
├ status bar 22px: ● 3 working ● 1 blocked ● 1 done ○ 5 idle      ⏚ herdr connected   5h ▰▱ 15% · 1h39m left ┤
```

- **Window:**
  - Set `decorations:false`.
  - The title bar takes `data-tauri-drag-region`, which needs the permissions
    `core:window:allow-start-dragging` and
    `core:window:allow-internal-toggle-maximize`, the second for double-click
    maximize (v2.tauri.app/learn/window-customization).
  - Set `"backgroundColor": "#1f1f1f"` to avoid a white flash.
  - Window controls are 46×30 px. They call **Rust commands**
    (`window_minimize`, `window_toggle_maximize`, `window_close`), not `core:window`
    JS permissions.
  - The close button's hover colour is `#c42b1c`.
  - Keep Windows resize borders working and verify them.
- **Fonts:**
  - UI font: `"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif`, 13px.
    Labels in the active tab and the selected row use weight 600. Numbers use
    `tabular-nums`.
- **Icons:** `@vscode/codicons` from **npm**, bundled locally (CSP `'self'`; allow
  the font in `font-src 'self'`). No CDN.
- **Spacing:** a 4px base. Exactly **one 1px separator** between any two adjacent
  regions.

## 4. Menus and shortcuts

Menus open on click. Once one menu is open, hovering the next menu title switches
to it. Menus close with Esc or an outside click. Arrow keys move between items.
Each item shows its shortcut on the right. Menus use the `menu.*` tokens. The
authoritative shortcut table lives in one TS module, `gui/src/shortcuts.ts`. Both
the menus and the key-capture layer read it.

| Menu | Item | Shortcut | Action |
|---|---|---|---|
| Workspace | New Workspace… | Ctrl+Shift+N | Rust folder picker → dedup → `workspace.create` |
| | Next / Previous Workspace | Ctrl+Shift+↓ / ↑ | `workspace.focus` on the neighbour in sidebar order |
| Tab | New Tab | Ctrl+Shift+T | `tab.create {workspace_id, focus:true}` |
| | Close Tab | Ctrl+Shift+W | `tab.close` (no confirm) |
| | Rename Tab… | F2 (tab UI focus only) | inline rename → `tab.rename {tab_id,label}` |
| | Next / Previous Tab | Ctrl+Tab / Ctrl+Shift+Tab | `tab.focus` |
| | Move Tab Left / Right | Ctrl+Shift+PgUp / PgDn | `tab.move {tab_id, insert_index: i-1 / i+2}` (pre-removal slot) |
| Pane | Split Right | Alt+Shift+= | `pane.split {direction:"right", focus:true, target_pane_id}` |
| | Split Down | Alt+Shift+- | `pane.split {direction:"down", focus:true, target_pane_id}` |
| | Close Pane | Alt+Shift+W | `pane.close {pane_id}`. On `confirmation_required`, show the notice |
| | Toggle Zoom | Alt+Shift+Z | `pane.zoom {pane_id}` (check the full shape in `src/api/schema/panes.rs`) |
| Agents | Jump to Next Needing Attention | Ctrl+Shift+J | first Blocked, then Done, in `snapshot.agent_order` (pane ids) → focus sequence |
| | Show Agent List | Ctrl+Shift+A | toggle the agent popover |
| | Sort: Priority / Server order | — | toggle, persisted |
| View | Toggle Sidebar | Ctrl+Shift+B | |
| | Color Theme ▸ | — | §2.4 |
| | Import VS Code Theme… | — | §2.3 |
| | Zoom In / Out / Reset terminal font | Ctrl+= / Ctrl+- / Ctrl+0 | 10–24px, persisted |
| | Desktop Notifications ✓ | — | toggle, persisted |
| herdr● | Settings… | Ctrl+, | open herdr `config.toml` with `tauri-plugin-opener::open_path` from Rust. The path is the `HERDR_CONFIG_PATH`-style override, else `config_dir()/config.toml` (`src/config/io.rs:195-200`; reuse `socket.rs` config_dir). Never create the file. If it is missing, run `reveal_item_in_dir` on the dir |
| | Keyboard Shortcuts | — | modal that lists `shortcuts.ts` |
| | Reload Config | — | `server.reload_config` |
| | What's New in X / Update Ready | — | a modal with `snapshot.release_notes.body` (plain text via `textContent`), or `update_install_command` with a Copy button. Hide the items that do not apply. |
| | Detach (keep agents running) | — | close the GUI window. The server and agents keep running. |
| Help | Reconnect | — | new Rust command `reconnect` sets `inner.connection = None` (Drop aborts the reader, `conn.rs:211-215`), and the loop reconnects |
| | About herdr GUI | — | version + server version from the welcome message + attribution: "Codicons © Microsoft, CC-BY-4.0" |

The **tab context menu** (right-click on a tab, or Shift+F10 when a tab has focus)
holds Split Right, Split Down, Rename…, and Toggle Zoom. If the tab is not
active, the action first runs `tab.focus`, then the pane action. The steps are
awaited in order.

## 5. Sidebar

- **Header:** `WORKSPACES` (11px/600, uppercase) with a `new-folder` codicon
  button that runs New Workspace….
- **Rows:** one row per workspace, **no nested tabs**. Rows are 44px high with two
  lines:
  - **Line 1:** an 8px status dot, then the name (`label`), with an ellipsis when
    it overflows.
  - **Line 2 (12px, `descriptionForeground`):** a `git-branch` codicon with the
    `branch`, then `↑a ↓b` from `git_ahead_behind` (the arrows are hidden when
    both are 0). With no branch, show a `folder` codicon and "no git".
- **Row states:**
  - Selected, meaning the focused workspace: `list.activeSelectionBackground`.
  - Hover: `list.hoverBackground`.
  - Blocked: a 2px left bar in `herdr.status.blocked`, static, with no pulse.
- **Close `×`:** it shows only while the row is hovered or focused. It is a 20×20
  codicon in `descriptionForeground` at 70% opacity with no background. On hover of
  the `×` itself it gets the `herdr.danger` background, white, at 100% opacity.
  - Clicking it opens the confirmation popover anchored right of the row: "Close
    **<name>**?" plus "N agents running · M blocked will be stopped", or "No agents
    running". It has [Cancel] [Close]. [Close] runs `workspace.close
    {workspace_id}`, and Esc cancels. On the error `workspace_group_close_required`
    (linked worktrees, `workspaces.rs:322-329`), ask again: "Also close N linked
    worktree workspaces?" and retry with `close_group:true`.
- **Status dots** (the same everywhere):
  - Working: filled `herdr.status.working`.
  - Blocked: filled orange.
  - Done: filled green.
  - Idle: a hollow 1.5px ring.
  - Unknown: a hollow dim ring.
- **Click** a row → `workspace.focus`.
- **Footer:** "+ New Workspace…" with its shortcut hint.
- **Sash:** 1px `sideBar.border` with an invisible 4px hit area. On hover or drag,
  after 150 ms, it shows `sash.hoverBorder`. Drag clamps the width to 180–400px,
  and the width is persisted.
- **Keyboard:** rows are focusable (`tabindex`) and show a `:focus-visible` ring.

## 6. Tab strip

- **Tab size:** 35px high, `min-width 96px`, `max-width 220px`, with padding
  `0 6px 0 12px`.
- **Label:** `label`, falling back to `number`.
- **Close slot:** 20×20 at the right. It shows the status dot at rest, and the
  `close` codicon on hover and on the active tab.
- **Active tab:** `tab.activeBackground`, which equals the terminal background,
  plus an inset 1px top border in `tab.activeBorderTop`. It merges into the
  terminal, with no rule beneath it.
- **Attention markers:**
  - A **Blocked** tab that is not focused gets a 2px top bar in
    `herdr.status.blocked`.
  - A **Done** tab dot stays green until the user focuses that tab. That "seen"
    state is client-side.
- **Mouse:**
  - Click → `tab.focus`.
  - Middle-click → `tab.close`.
  - Double-click → inline rename: Enter commits with `tab.rename`, Esc cancels,
    and an empty name reverts.
- **Drag to reorder:**
  - Dragging drops the source tab to 0.5 opacity and shows a 2px
    `tab.dragAndDropBorder` caret at the drop point.
  - On drop, reorder optimistically and call `tab.move {tab_id, insert_index}`.
    `insert_index` is the drop slot in the tab list **before** the source is
    removed (0..=len): "insert before the tab now at index i; len = end"
    (`src/workspace.rs:591-614`, test `tabs.rs:379-426`). Move Left = i−1, and
    Move Right = i+2. A drag sends the caret slot directly. Pin these semantics in
    a unit test.
  - The next snapshot is authoritative. On an error, snap back and show a notice.
- **`+` button** after the last tab → New Tab.
- **Overflow:**
  - The tabs shrink to their min-width, then scroll horizontally with the mouse
    wheel. The active tab always scrolls into view.
  - A `chevron-down` at the far right opens a list of every tab with its status
    dot.

## 6a. Workspace colours (user-approved; see `mock-d.png`, `?state=d`)

- **Palette:** 10 theme-overridable keys `herdr.workspace.1` … `herdr.workspace.10`.
  The defaults, in this order, are `#60a5fa #a78bfa #2dd4bf #f472b6 #facc15 #22d3ee
  #fb7185 #a3e635 #818cf8 #e879f9`.
- **Assignment:**
  - When a workspace id is first seen, give it the lowest palette index that no
    live workspace is using. If all 10 are in use, cycle by count.
  - Persist it in `settings.json` as `workspaceColors: {workspace_id: index}`,
    pruned against the snapshot. A colour never changes on its own.
- **Override:** right-clicking a sidebar row opens a context menu with
  `Rename…` (`workspace.rename`) and `Change Color ▸`. The second opens a 5×2
  swatch grid with the current colour ringed. The choice is persisted.
- **Where the colour shows:**
  - **Sidebar:** a 10×10 px rounded square (radius 3) before the name. The status
    dot stays in its own column to the left.
  - **Tabs:** **every** tab of the workspace has an inset top border in the
    workspace colour at all times: 2px when inactive, 3px on the active tab. The
    tab strip's bottom edge is the workspace colour mixed 45% with `tab.border`.
    The active tab keeps the terminal background and a weight-600 label.
  - **Agent popover rows and toasts:** the square before `workspace · tab`.
- **Conflict resolved:** the tab top border belongs to the workspace colour. A
  **Blocked** tab shows its orange status dot **and** an orange label
  (`herdr.status.blocked`) instead of the orange top bar that §6 described. §6's
  attention marker is replaced by this rule.
- **Tests (Vitest):** lowest-free assignment, stability across snapshots,
  pruning, the override persisting, and a cycle when there are more than 10.

## 7. Status bar and popovers

- **Height:** 22px, 12px text, items `0 8px`, and spacing only, with no glyph
  separators.
- **Left side:** agent counts per status that is > 0, each with its dot:
  `3 working`, `1 blocked`, `1 done`, `5 idle`. A click opens the agent popover,
  filtered to nothing; it only scrolls to that status group.
- **Right side:**
  - `plug` codicon + "herdr connected", or "reconnecting…" in the warning colour.
  - The usage item: `pulse` codicon, `5h`, a 64×4px meter, then
    `15% · 1h39m left`.
    - The item background is `statusBarItem.warningBackground` at ≥ 70% and
      `statusBarItem.errorBackground` at ≥ 90%.
    - When the window has reset, it shows `5h — reset`.
    - With no data, it shows a muted "Claude usage: waiting".
- **Usage popover** (hover or keyboard focus, 250px, `editorHoverWidget.*`):
  - The title "Claude usage" + "as of N m ago".
  - The 5-hour row: `15% · resets in 1h39m`, then a full-width meter.
  - The weekly row: `6% · resets Sat 08:00` (local time), then a meter.
  - It stays open while the pointer is on it and closes 150 ms after leave.
- **Agent popover** (anchored bottom left, 340px):
  - The header shows `AGENTS` and a `priority ▾` sort toggle.
  - Each row has a dot, then `workspace label · tab label` on line 1 and
    `display_agent — title` on line 2. `title` falls back to
    `terminal_title_stripped`, then to nothing.
  - **Never show raw pane ids.**
  - Clicking a row runs the awaited focus sequence
    (`workspace.focus` → `tab.focus` → `pane.focus`) and closes the popover.
    Arrow keys and Enter work.
- **Done notification:**
  - **Detection:** diff consecutive snapshots per `pane_id`. A notification fires
    when `agent_status` becomes `done` from any other status with a higher
    `state_change_seq`. The baseline resets on a `boot_id` change, on a
    `connection-status` other than connected, and on the `sync_state` replay.
    Never fire from a baseline. Ignore agents whose pane has disappeared.
  - **In-app:** open the agent popover and move that row to the top as a
    "highlight card". It has a 1px `herdr.status.done` ring with a soft outward
    glow, "DONE · just now", the title, and "Enter ↵ jump". It auto-hides after
    8 s, and hover pauses the timer.
  - Several transitions within 8 s stack as highlight cards, up to 3.
  - **Window unfocused:** call the Rust command `notify_agent_done {workspace,
    tab, agent, title}`. It calls `window.request_user_attention(Informational)`
    and, if the setting is on, sends a `tauri-plugin-notification` toast titled
    "✓ <workspace> · <tab>" with the body "<agent> finished — <title>". The rate limit
    (one toast per 5 s, with extra transitions coalesced into "and N more")
    lives in **Rust** and is tested there. Truncate the toast title and body to
    64 and 200 characters and strip control characters.
  - Clicking the toast just focuses the app, which shows the in-app card.

## 8. Terminal renderer fixes (from the finish-gate review)

All of these are in `gui/src/main.ts` (the renderer). Extract the pure metric
maths to `gui/src/render/metrics.ts` so it can be unit-tested.

1. **Font:** `"Cascadia Mono","Cascadia Code",Consolas,monospace`, 14px by
   default, set by `Ctrl+=`/`-`/`0`. Cascadia Mono ships with Windows 11 as a
   variable font (wght 200–700), so draw bold at weight `700`. Do **not** probe
   with `document.fonts.check`, which cannot detect a bold face (MDN).
2. **Draw in device pixels with no `setTransform` scaling:**
   - `fontPx = size × dpr`.
   - `cellW = round(measureText("M").width)` in device px.
   - `cellH = round(fontPx × 1.2)` (the Windows Terminal default), so 14px becomes
     17px at DPR 1. Use `fontBoundingBox*` only to centre the baseline.
   - `resize` sends `cell_w`/`cell_h` in **device** px.
   - **Integral origin.** The chrome heights (30/35/22) × 1.25 are fractional. Read
     `canvas.getBoundingClientRect().top/left × dpr`. If a value is fractional,
     shift the canvas by `(round(v) − v)/dpr` px with `transform: translate()` so
     the backing store maps 1:1 onto device pixels.
   - Canvas backing size = `floor(avail × dpr)`, and CSS size = backing size / dpr.
   - `cols = floor(backingW / cellW)` and `rows = floor(backingH / cellH)`.
   - Recompute on font size, DPR (`matchMedia` resolution change), or container
     resize.
3. **Baseline:** `textBaseline = "alphabetic"`, drawn at
   `rowTop + round((cellH - (ascent + descent)) / 2) + ascent`.
4. **Box drawing and blocks:** draw U+2500–U+257F lines (light and heavy,
   horizontal, vertical, and corners at minimum; rounded corners may fall back to
   square) and U+2580–U+259F block elements as filled rects or paths that span
   the whole cell. That removes the dashed-rule gaps. Other glyphs are clipped to
   `cellW × (1 + following skip cells)`, so CJK and emoji keep their width.
5. **Clear and clip:**
   - On a full frame, a dimension change, a metric change, or a theme change,
     clear the **whole** canvas to `terminal.background`.
   - Paint only rows and columns `< min(grid, rows/cols)`.
   - The leftover strip is background only.
6. **Inset:** the terminal container has an 8px inset on all sides. The grid is
   computed from the content box.
7. **Cursor:**
   - Focused: a solid block in `terminalCursor.foreground`, with the glyph
     redrawn in `terminal.background`.
   - Unfocused (the keyboard capture is blurred): a hollow 1px box.
   - Mark the old and new cursor rows dirty.
8. **Colours:**
   - Named colours 0–15 → `terminal.ansi*`.
   - Reset → `terminal.foreground` / `terminal.background`.
   - Indexed colours 16–255 → the xterm table.
   - A theme change repaints everything.
9. **Focus:** when the terminal loses keyboard focus, show the hollow cursor. A
   click on the canvas re-focuses the capture.

## 8a. Renderer performance

Today the renderer calls `fillRect` **and** `fillText` once per cell
(`gui/src/main.ts:256,262`), so a full 200×50 frame is up to 20,000 canvas calls.
Canvas text calls are the most expensive calls in the frame.

1. **Background runs:** in each dirty row, merge consecutive cells with the same
   bg into one `fillRect`.
2. **Glyph atlas:**
   - Render each distinct `(symbol, fg, bold, italic)` once into an
     `OffscreenCanvas` atlas at the current cell size and DPR.
   - Draw with `drawImage(atlas, sx, sy, w, h, dx, dy, w, h)`.
   - Cap the atlas at 4096 entries with an LRU. Clear it on a font, DPR, or theme
     change.
   - Skip spaces entirely: the bg already painted them.
   - Draw box and block glyphs (§8.4) as rects, not through the atlas.
3. **One rAF per frame:** keep the coalescing. Paint only dirty rows. Never read
   layout (`getBoundingClientRect`) inside the paint loop.
4. **Perf HUD:**
   - `Ctrl+Shift+Alt+P` toggles a small overlay. It shows the Rust
     decode+apply+encode µs per frame (sent with each surface message as a
     trailing u32), the TS decode ms, the paint ms, the frames per second, and the
     dirty rows per frame.
   - Log a `debug` line every 5 s with the p50 and p95 values.
5. **Budget:** paint p95 < 4 ms and TS decode p95 < 1 ms for a full 200×50 frame on
   this machine. Measure it in a **release** build (`npx tauri build
   --no-bundle`). `tauri dev` compiles the Rust side unoptimized and is not
   representative.
6. **Vitest:** the run-merging function and the atlas key and LRU eviction.

## 9. Other fixes

1. **Empty log file:** `%LOCALAPPDATA%\herdr-gui\logs\herdr-gui.log` is created but
   stays empty. Initialize the `tracing` subscriber with a file writer that
   flushes (a non-blocking appender whose guard is held for the process
   lifetime), at level `info` by default and `HERDR_GUI_LOG` to override. Log
   connect, disconnect, the handshake result, resyncs, and decode skips. Never log
   usage-file contents or snapshot text bodies.
2. **Focus rings:** `:focus-visible` gives a 1px `focusBorder` ring on tabs,
   sidebar rows, menu items, and status bar items.
3. **Disconnected layout:** the banner is an overlay at the top of the terminal
   area and does not push the status bar off screen.
4. **Settings persistence:** `%APPDATA%\herdr-gui\settings.json`, resolved with
   `env::var("APPDATA")` like `lib.rs::log_dir` and **not** `app_config_dir()`,
   which gives `dev.herdr.gui`. It holds `{theme, workspaceFolders,
   sidebarWidth, sidebarVisible, fontSize, agentSort, desktopNotifications}`.
   **Startup order:** `settings_get` → apply the theme → `sync_state` →
   `report_ready`. The window stays hidden until then, so there is no flash of
   the default theme. Rust
   commands `settings_get` and `settings_set` do an atomic write. A corrupt file →
   defaults plus a notice.

## 10. Dependencies (new, each with its reason)

- Rust:
  - `tauri-plugin-dialog` 2.x: the folder picker and the theme file picker, called
    from Rust only.
  - `tauri-plugin-notification` 2.x: desktop toasts, called from Rust only.
  - `zip`: `.vsix` import.
  - A JSONC parser: VS Code theme files.
  - `tracing-appender`: the log fix, if it is not already present.
- npm: `@vscode/codicons` (**CC-BY-4.0**; add attribution in About), with the icon
  font bundled locally. `default-src 'self'` already covers `font-src`, so no CSP
  edit is needed.
- `tauri-plugin-prevent-default` (feature `platform-windows`): stops WebView2 from
  swallowing F5/F3/Ctrl+F/Ctrl+P/Ctrl+R.
- `tauri-plugin-opener`: Settings… opens config.toml, called from Rust only.
- **Capabilities:** add only `core:window:allow-start-dragging` and
  `core:window:allow-internal-toggle-maximize`. No plugin gets any webview
  permission.

## 11. Polish checklist (the main session checks this on screenshots)

1. Row pitch ≥ 1.15× the font size, with descenders g/y/p fully visible.
2. `─` rules are unbroken, and `│` stacks without gaps.
3. At 125% and 150% Windows scaling, there are no seams between same-colour
   background cells, and glyphs are sharp.
4. No partial row or column at the canvas edges.
5. The terminal inset is ≥ 8px, and column 0 never touches the sash.
6. There is one background token for chrome and terminal, or a second one
   separated by exactly one 1px border.
7. Sidebar rows are 44px with one indent scale and no raw ids anywhere.
8. The tab strip is 35px. The active tab equals the content background, with a
   1px top accent and no rule beneath. Close appears on hover and on the active
   tab. Inactive tabs are darker.
9. There is exactly one 1px separator between adjacent regions.
10. The sash is invisible until hover, and its hover is `sash.hoverBorder`, never
    red.
11. There are zero bordered text buttons in the chrome. Only codicons and menus.
12. All 16 ANSI colours are ≥ 4:1 against the terminal background in Dark Modern.
13. Tab-key navigation shows a `focusBorder` ring on tabs, rows, and menus.
14. The disconnected state shows both the banner and the status bar.
15. The status bar is 22px, the 5h meter is visible, and hover shows the weekly
    popover.
16. The title bar is dark and themed, the window controls work, and dragging and
    double-click maximize work.
17. The workspace `×` is subtle on row hover and red on `×` hover (compare
    `ws-close-zoom.png`).
18. Every tab shows its workspace colour as a top border, 2px inactive and 3px
    active, and each sidebar row shows the matching colour square (compare
    `mock-d.png`).

## 12. Live behaviours (checked against `gui-test` only)

- New Workspace… → pick a folder → a workspace appears named after that folder,
  and its shell starts in that folder. Picking the same folder again focuses the
  existing workspace.
- Ctrl+Shift+T opens a new tab in the current directory. Plain Ctrl+T reaches the
  terminal: in PowerShell it swaps characters.
- Tab: close with × (no confirm), middle-click close, rename, drag reorder (the
  order persists after the next snapshot), and Split Right/Down from the tab menu.
- Workspace ×: confirm, then close.
- An agent (or `sleep 3` wrapped as a pane agent, if a real Claude run is not
  practical) reaching Done → the popover highlight appears. With the window
  unfocused, the taskbar flashes and a toast appears.
- Import a real VS Code theme `.vsix` or `.json`. It applies live and survives a
  restart.
- The log file has content.

## 13. Tests (added to `npm run check`)

- **Rust:**
  - The toast rate limiter.
  - JSONC parse: comments and trailing commas.
  - `include` resolution: depth, cycle, and a vsix-relative path.
  - vsix with several themes.
  - zip-slip rejected, size limits, and invalid colours skipped and counted.
  - Settings atomic write, and a corrupt file → defaults.
- **Vitest:**
  - Theme merge and fallback chain, including `herdr.*`, `terminal.background` →
    `editor.background`, and the ansi mapping into the renderer palette.
  - `shortcuts.ts`: every claimed key is in the allowed classes of §1, there are
    no duplicates, and plain `Ctrl+<letter>` is never claimed.
  - Done-transition detector: first snapshot, reconnect, seq ordering, stacking
    ≤ 3, and the rate limit.
  - The `tab.move` pre-removal insert_index calculation.
  - Path normalization + dedup rules (case, slashes, trailing separator, UNC,
    shared `new_workspace_cwd` → no dedup).
  - Pane actions always carry an explicit pane id.
  - Metrics maths (§8.2) at DPR 1, 1.25, 1.5, and 2.
  - Box-drawing classification.
  - Usage popover formatting (local time).
  - Agent row text (no pane ids).
  - Workspace-close popover text (the agent counts).

## 14. Out of scope

Editor, file tree, git diff, LSP, ADB, and Playwright (later phases); the agent
list pinned in the sidebar; per-pane chrome and the GUI drawing its own pane
borders (the server still draws them); workspace drag reorder; copy and paste,
and text selection; light-theme polish beyond "tokens apply"; and macOS/Linux
window chrome.

## 15. Risks and how this could be wrong

- **`decorations:false` on Windows** can lose the snap layouts flyout and change
  the resize borders. Known issues: tauri#9053 (resize edges), #12285 (inner size
  off by a border with `shadow:true`), and #14859. Verify all three.
  `titleBarStyle` exists on macOS only. The Windows fallback is
  `decorations:true` + `"theme": "Dark"` (a dark DWM caption), with the menu bar
  as the first row inside the window. Report which one was used.
- **Toast identity:** in dev builds the toast shows a generic app identity. It
  becomes "herdr" only after installation.
- **Metrics:** `fontBoundingBox*` exists in Chromium ≥ 87, so WebView2 153 has it.
