# herdr GUI — Phase 1 spec

Status: v2 (Opus, revised after Fable review: 1 blocker, 7 major, 6 minor applied).
Pending: user OK.

## 0. Goal and success criterion

A Tauri 2 desktop app (`herdr-gui`, Windows first) that attaches to a running herdr
server as a client and gives the standard herdr functions in a GUI, plus a bottom bar
with Claude plan usage (5-hour and weekly).

Phase 1 is **done** when all of these pass on the user's Windows 11 machine:

1. `npm run check` in `gui/` exits 0 (see §9).
2. Live check (§10): the app attaches to a dedicated herdr test session, shows the
   workspace/tab tree and agent status, renders the active tab's terminal, accepts
   typing (`echo hi` + Enter prints `hi`), follows focus/create/close actions, and
   shows the usage bar from `~/.claude/herdr-usage.json`.
3. `npm run bench:startup` reports median `first_paint_ms < 1000` and
   `attach_ms < 300` over 5 cold runs.

## 1. Context the executor needs (verified facts, with sources)

herdr is a Rust terminal multiplexer. A background **server** owns PTYs, layout, and
agent detection. The ratatui TUI is one **client**. The GUI is a second client. The
herdr server stays **unmodified** in Phase 1.

- **Sockets (Windows = named pipes).** The client socket is
  `<config_dir>/herdr-client.sock`, with `config_dir = %APPDATA%\herdr` for release
  builds (`src/config/io.rs:22-27,45-54`). **Debug builds use `herdr-dev`**
  (`io.rs:22-28`), and `XDG_CONFIG_HOME` wins even on Windows (`io.rs:30-35`). The
  GUI hard-codes the app dir name `herdr`, and live tests use the installed release
  `herdr` 0.9.1, never `cargo run`. The pipe name is the full path string
  through `interprocess` `GenericNamespaced` (`src/ipc.rs:44-51,66-78`). Live example:
  `\\.\pipe\C:\Users\Reinaldo\AppData\Roaming\herdr\herdr-client.sock`.
  `HERDR_SOCKET_PATH=<p>` overrides; the client socket is then
  `<p stem>-client.sock` (`src/server/socket_paths.rs:23-58`). Named sessions live
  under `<config_dir>/sessions/<name>/` (`src/session.rs:161-185`) and are selected
  by herdr's own env var `HERDR_SESSION` (`session.rs:10,96-101`). The `.sock`
  file on disk is only a marker (`ipc.rs:76`). Never infer "server down" from it:
  only a failed connect means down.
- **Framing.** 4-byte **little-endian** `u32` length, then a bincode v2 payload,
  `bincode::config::standard()`, serde path. Trailing bytes are an error. See
  `src/protocol/wire.rs:1662-1715`. **The GUI reads with a 32 MiB cap**
  (`MAX_GRAPHICS_FRAME_SIZE`, `wire.rs:29`), not 2 MiB, because `PaneSurface`
  frames with image assets can exceed 2 MiB. If a claimed length still exceeds
  32 MiB, read and discard exactly `claimed_len` bytes so the stream stays in
  sync, then continue.
- **bincode encodes the enum variant index.** `ClientMessage` (`wire.rs:470-623`) and
  `ServerMessage` (`wire.rs:1390-1510`) variant **order** is load-bearing. Watch for
  `#[cfg(...)]` attributes on variants: they change indexes per target. Compute the
  indexes for `cfg(windows)` and `cfg(unix)` from the source, do not count by eye.
- **Endpoint generation 1 is frozen** (`AGENTS.md:83-94`). Frozen digests live in
  `src/protocol/wire.rs` tests (`encoded_sha256`, from line 1864). Fixtures:
  `tests/fixtures/endpoint-{hello,welcome,snapshot}-v1.json`,
  `tests/fixtures/endpoint-method-shapes-v1.json` (a map of method → sha256 of a
  JSON schema; it holds **no** param shapes).
- **Handshake.** Client sends `ClientMessage::EndpointControl { kind:
  "endpoint.hello.v1", data: <JSON EndpointClientHello> }`
  (`src/client/handshake.rs:182-208`, `src/protocol/endpoint.rs:47-72`). The full
  hello the GUI sends:
  ```json
  {"generation":1,"cell_width_px":<px>,"cell_height_px":<px>,
   "surface_size":{"cols":<c>,"rows":<r>},"pixel_mouse":false,
   "direct_graphics":false,"endpoint_keybindings":false,"mouse_capture":true,
   "surface_active":true,"surface_reuse":false,"surface_delta":false,
   "snapshot_codecs":["shell.snapshot.v1"],"surface_codecs":["shell.surface.v1"],
   "input_codecs":["shell.input.semantic.v1"],"blob_codecs":["shell.blob.v1"]}
  ```
  `surface_active:true` makes the server claim geometry and foreground for this
  client (`headless.rs:1963-1970`). No `client_shell.surface.set` call is needed.
  With reuse and delta off, only plain `PaneSurface` / `PaneSurfacePatch` arrive.
  The server answers `EndpointControl { kind:"endpoint.welcome.v1" }`
  (`endpoint.rs:155-176`). Welcome `capabilities` need no client action: health
  pings and presentation sync are client-initiated
  (`client_endpoint_control.rs:1-8`). **Ignore unknown `EndpointControl` kinds**:
  `endpoint.agent-completions.v1` and `endpoint.agent-view.v1` can arrive before
  the snapshot.
- **Snapshot.** `EndpointControl { kind:"shell.snapshot.v1", data: <JSON
  ClientShellSnapshot> }`, resent when its `revision` changes
  (`src/server/headless.rs:1933-1962`). Holds `workspaces[]`, `tabs[]`, `panes[]`,
  `agents[]` with `agent_status`, and `focused_*` (`wire.rs:922-1093`). It is resent
  on any change with `revision+1` (`render.rs:578-618`).
  **Counterintuitive (verified):** on the endpoint lane the snapshot arrives as JSON
  inside `EndpointControl.data` (`endpoint.rs:106-111`).
  `ServerMessage::ClientShellSnapshot` is the private-protocol path. The GUI does
  not use it.
  `agent_status` strings use a custom deserializer: an unknown string → `Unknown`
  (`wire.rs:901-918`). The fixture's `future_status_from_new_server` case depends on
  this.
- **Surface = ONE composited grid per connection, for its active tab.**
  `PaneSurface(PaneSurfaceFrame)` doc: "One server-rendered active-tab surface without
  sidebar, tab bar, or overlays" (`wire.rs:1272`). It contains `frame.cells[w*h]`,
  `cursor`, and per-pane `rect`/`inner_rect`. **The server does the layout and draws
  the split borders.** Patches: `PaneSurfacePatch { base_surface_revision,
  surface_revision, rows:[{x,y,cells}], panes, cursor }` (`wire.rs:1288-1313`).
- **Patch acceptance rule** (port `src/client/shell/surface_patch.rs:33-169`
  exactly). Reject when any of these is true:
  1. There is no current surface.
  2. `boot_id` or `projection_revision` differs.
  3. `base_surface_revision != current.surface_revision`.
  4. `surface_revision != current.surface_revision + 1`.
  5. `current.popup.is_some()`.
  6. `current.graphics.placements` or `retained_assets` is non-empty.
  7. Any `patch.panes[i].pane_id` is missing from the current panes.
  8. Any patched pane's geometry changed. Geometry equality is `pane_id, rect,
     inner_rect, focused, pixel_width, pixel_height` (`surface_patch.rs:96-106`).
  9. Any row is empty, exceeds `frame.width`/`height`, or lies outside a patched
     pane's `inner_rect` (or its `scrollbar_rect`).

  Apply = overwrite the row spans, replace the matching `panes`, set
  `frame.cursor = patch.cursor`, and set `surface_revision =
  patch.surface_revision` (`surface_patch.rs:33-55`).
- **Resync on reject (verified).** The TUI keeps the old grid and waits
  (`src/client/mod.rs:1501`). The GUI keeps the old grid **and** resends
  `ClientShellResize` with the current size. The server handles that with
  `client.request_repaint()` (`headless.rs:2169-2196`). That clears `last_surface`
  (`render_stream.rs:99-101`), so the next frame is a full `PaneSurface` with
  `surface_revision+1` (`render_stream.rs:172-190`).
- **No ratatui type is on the wire.** `CellData`, `CursorState`, and `SurfaceRect`
  are plain structs. `CellData` is `{symbol, fg:u32, bg:u32, modifier:u16, skip,
  hyperlink}`.
- **Colour packing:** `0x00_0000XX` named (0 = Reset), `0x01_0000II` indexed,
  `0x02_RRGGBB` RGB (`wire.rs:703-716,1516-1545`). Values proven by the
  `pane_surface_roundtrip` digest (`wire.rs:2595`): Rgb(255,128,0) = `0x02FF8000`,
  Indexed(220) = `0x010000DC`, Cyan = 7, Blue = 5, Yellow = 4, Magenta = 6.
- **`modifier` bits:** BOLD 1, DIM 2, ITALIC 4, UNDERLINED 8, SLOW_BLINK 16,
  RAPID_BLINK 32, REVERSED 64, HIDDEN 128, CROSSED_OUT 256. Bits 12–15 are herdr's
  underline-style nibble (`wire.rs:1582-1605`). Mask them off before styling.
- **Non-wire-module types to copy:**
  - `AgentStatus`: `#[serde(rename_all="snake_case")]` Idle, Working, Blocked, Done,
    Unknown (`api/schema/common.rs:158-166`), plus the custom deserializer above.
  - `ToastHerdrPosition`: `kebab-case`, TopLeft, TopRight, BottomLeft, BottomRight
    (`config/model.rs:71-81`).
  - `WindowsKeyRecord`: plain serde, no cfg. Fields `key_down:bool,
    repeat_count:u16, virtual_key_code:u16, virtual_scan_code:u16, unicode:u16,
    control_key_state:u32` (`input/model.rs:6-14`).
- **Custom byte serializer:** `SurfaceGraphicsAsset.data` uses `serialize_bytes`
  when the format is not human-readable (`wire.rs:1193-1240`). Copy that
  serializer, or live frames with images fail to decode. Ignore the
  `bincode::Decode` derives.
- **Input.** `ClientShellPaneInput { pane_id, events: [ClientPaneInputEvent] }`
  (`wire.rs:586-589`, enum at `wire.rs:157-178`): `Key{..}`, `TextCommit(String)`,
  `Mouse{..}`, `Paste(String)`. The GUI sends `Key` as:
  - `modifiers`: crossterm bits (SHIFT 1, CONTROL 2, ALT 4, SUPER 8).
  - `kind: Press`, `repeat_count: 1`.
  - `shifted_codepoint: None`, `generated_text: None`.
  - `tracks_release: false`. `true` makes the server hold a synthetic release
    (`clients.rs:277-300`).
  - `physical_key_id: None`, `windows_record: None`. The type still has to match for
    bincode, so copy `WindowsKeyRecord`.

  `ClientKeyCode` (`wire.rs:65-84`): Backspace, Enter, Left, Right, Up, Down, Home,
  End, PageUp, PageDown, Tab, BackTab, Delete, Insert, Esc, Char(char), F(u8), Null.
  Ctrl+C = `Char('c')` + CONTROL. Shift+Tab = `BackTab`.
- **Resize.** `ClientShellResize { cell_w, cell_h, surface_size, pixel_mouse }`. One
  client per tab is the "geometry controller", and its size resizes the PTYs
  (`src/server/headless/client_views.rs:656-733`).
- **Commands.** `ClientShellEndpointRequest { boot_id, request }`. `request` is a JSON
  API request string `{"id","method","params"}`. The reply is one or more
  `ClientShellEndpointResponseChunk { boot_id, request_id, final_chunk, data }`. Only
  methods in `CLIENT_SHELL_METHODS` are allowed (`src/server/client_commands.rs:6-47`):
  `workspace.create/close/focus`, `tab.create/close/focus`, `pane.split/close/focus`,
  and more.
  - **Param shapes** come from `src/api/schema.rs` (`Method`,
    `#[serde(tag="method", content="params")]`) and
    `src/api/schema/{workspaces,tabs,panes,common}.rs`. Envelope:
    `{"id":"<uuid>","method":"tab.focus","params":{…}}`.
  - **Shapes used in Phase 1:**
    - `workspace.create {focus?:bool, cwd?, label?}`
    - `workspace.close {workspace_id, close_group?}`
    - `workspace.focus {workspace_id}`
    - `tab.create {workspace_id?, focus?, cwd?, label?}`
    - `tab.focus {tab_id}`
    - `tab.close {tab_id}`
    - `pane.split {direction:"right"|"down", target_pane_id?, ratio?, focus?}`
    - `pane.focus {pane_id}`
    - `pane.close {pane_id}`
  - **Reply:** concatenate the chunk `data` until `final_chunk`. The result is
    `{"id","result":{"type":…}}` or `{"id","error":{"code","message"}}`
    (`schema/response.rs:31-44`).
  - **`boot_id`** = `snapshot.boot_id`. A mismatch → `stale_boot`
    (`endpoint_requests.rs:27-35`).
  - **One request in flight per connection**, or the server answers
    `endpoint_busy` (`endpoint_requests.rs:57-66`). `api()` must queue requests.
  - **Focus scope (verified):** `tab.focus`, `pane.focus`, and `workspace.focus`
    change only this connection's view (`client_views.rs:340-360`). The TUI's view
    is untouched.
- **Usage data.** Claude Code's statusLine hook writes `~/.claude/herdr-usage.json`
  (already installed by the user, `~/.claude/statusline/herdr-usage.py`). Shape:
  ```json
  {"captured_at": 1790388472,
   "rate_limits": {"five_hour": {"used_percentage": 14, "resets_at": 1790395200},
                   "seven_day": {"used_percentage": 1, "resets_at": 1790985600}}}
  ```
  All timestamps are Unix epoch **seconds**. `used_percentage` is **0–100** (a float
  or an int). Each window can be absent. `spend_limit` can appear with the same
  shape: ignore it in Phase 1. Source: code.claude.com/docs/en/statusline.md (the
  `rate_limits` field). The GUI **never** reads `~/.claude/.credentials.json`.

## 2. Architecture

```
gui/
  Cargo.toml              # [workspace] members = ["src-tauri", "crates/herdr-wire"]
  package.json            # Vite + TS, vanilla (no UI framework)
  index.html, src/        # frontend
  src-tauri/              # crate `herdr-gui` (Tauri 2 app)
  crates/herdr-wire/      # crate `herdr-wire`: wire types + framing, no Tauri deps
  tests/golden/           # shared golden bytes Rust <-> TS
  tests/e2e/              # WebdriverIO + tauri-driver smoke
  scripts/bench-startup.mjs
```

- `gui/` is a separate Cargo workspace. Do **not** add `gui` to herdr's root
  `Cargo.toml`, and do not change that file.
- **State ownership.** The herdr server owns all session truth. The Rust backend owns
  the connection, the authoritative mirror of the current grid (`SurfaceMirror`), the
  last snapshot, and the usage state. The frontend owns presentation only: the canvas,
  sidebar DOM, and the focus highlight. The frontend keeps a grid copy for painting,
  fed only by backend messages.
- **Data flow.**
  herdr pipe → `conn` task (tokio) → decode → `SurfaceMirror.apply` →
  encode a compact binary frame (§5) → `tauri::ipc::Channel` (raw bytes) → TS
  decoder → canvas paint of dirty rows. Snapshots and usage go as JSON events
  (small and infrequent).
- **Rendering (Phase 1).** Paint the whole composited grid as-is on one `<canvas>`
  (Canvas 2D), including the server-drawn borders. Repaint dirty rows only, and
  coalesce with `requestAnimationFrame`. No per-pane cropping yet: that is Phase 2
  restyle work. Skip hyperlinks, graphics, and popups in Phase 1. Draw the
  cursor from `cursor`.

## 3. `herdr-wire` crate

- Deps: `serde` (derive), `bincode = { version = "2", features = ["serde"] }`,
  `serde_json`. Dev: `sha2`. No ratatui, no tokio.
- Copy (not link) the types reachable from the messages below, with **identical**
  field order, types, and serde attributes:
  - `ClientMessage`: every variant must exist so indexes match. The GUI serializes
    only `EndpointControl`, `ClientShellResize`, `ClientShellPaneInput`,
    `ClientShellEndpointRequest`, and `ClientShellFocus`. Other variants may carry
    their real payload types or be omitted **only if** omission cannot shift an
    index. Simplest correct choice: copy all variants with real types.
  - `ServerMessage`: the GUI decodes `EndpointControl`, `PaneSurface`,
    `PaneSurfacePatch`, `ClientShellEndpointResponseChunk`, `ClientShellError`, and
    `ServerShutdown`. Copy all variants and their types (ratatui-typed fields: use
    the serde-equivalent representation herdr puts on the wire, and verify with
    digests).
  - JSON types: `EndpointClientHello`, `EndpointServerWelcome`, `ClientShellSnapshot`
    and children (serde_json, unknown fields allowed, new enum values → `Unknown`).
- Framing API:
  `pub fn write_frame<W: Write>(w, &ClientMessage) -> io::Result<()>`
  `pub fn read_frame<R: Read>(r, max: usize) -> Result<Vec<u8>, FrameError>` (returns the raw payload)
  `pub fn decode_server(payload: &[u8]) -> Result<ServerMessage, DecodeError>` (rejects trailing bytes)
  Async variants for tokio are allowed in `src-tauri` on top of these.
- **A decode failure skips one frame.** The frame is length-delimited, so the stream
  stays in sync. Log `warn!` with the variant index, and continue. Do not
  disconnect. Read cap: 32 MiB. An oversize claim → discard `claimed_len` bytes
  (§1 Framing).

## 4. `src-tauri` backend (`herdr-gui`)

Modules (one file each unless noted):

- `socket.rs` — `fn client_socket_path() -> PathBuf`: `HERDR_SOCKET_PATH` →
  `<stem>-client.sock`, then legacy `HERDR_CLIENT_SOCKET_PATH`, then
  `%APPDATA%\herdr\herdr-client.sock` (`XDG_CONFIG_HOME/herdr` if set). Honour
  herdr's own `HERDR_SESSION=<name>` →
  `<config_dir>/sessions/<name>/herdr-client.sock`. Use the same precedence as
  `socket_paths.rs:23-48`. Do not invent a new env var.
- `conn.rs` — connect with `interprocess` (same crate as herdr: `interprocess =
  "2.4"`, tokio feature), then do the handshake. Timeout 2 s → state `Unavailable`,
  and retry every 2 s with a visible status. After the welcome, loop: read frame →
  dispatch. On `ServerShutdown` or EOF → state `Disconnected` and reconnect loop.
- `mirror.rs` — `SurfaceMirror { boot_id, projection_revision, surface_revision,
  width, height, cells: Vec<Cell>, panes, cursor }`,
  `apply_full(frame) -> Delta::Full`, `apply_patch(patch) -> Result<Delta::Rows,
  Rejected>` with the exact acceptance rule from §1.
- `usage.rs` — poll the `mtime` of `~/.claude/herdr-usage.json` every 2 s (no
  watcher dependency). Parse into
  `UsageState { five_hour: Option<Window>, seven_day: Option<Window>, captured_at:
  Option<i64>, status: Ok | Missing | Invalid }` with `Window { used_pct: f64,
  resets_at: i64 }`. Clamp `used_pct` to 0..=100. Emit `usage` on change.
- `commands.rs` — Tauri commands: `send_input(pane_id, events)`, `resize(cols, rows,
  cell_w, cell_h)` (debounce 50 ms in TS), `api(method, params) -> Result<Value,
  ApiError>` (wraps `ClientShellEndpointRequest`, correlates `request_id`, 5 s
  timeout), `report_ready(ms)`, and `subscribe_surface(channel: Channel)`.
- `main.rs` — capture `Instant::now()` first thing. The window is `visible: false`
  and is shown in `report_ready`. With `HERDR_GUI_BENCH=1`, print one JSON line
  `{"first_paint_ms":..,"attach_ms":..}` to stdout and exit after `report_ready`.
  `attach_ms` = from connect start to the first `PaneSurface` applied.
- Logging: `tracing` to `%LOCALAPPDATA%\herdr-gui\logs`. No `unwrap()` outside tests.
- Tauri security: a strict CSP (`default-src 'self'`), no fs/shell/http plugins, and
  capabilities limited to core window, event, and the app's own commands.

## 5. Backend → frontend binary surface format (v1, little-endian)

```
u8  kind            1 = full, 2 = rows
u64 surface_revision
u16 width, u16 height
u16 cursor_x, u16 cursor_y, u8 cursor_visible
u16 row_count
repeat row_count:
  u16 y, u16 x, u16 cell_count
  repeat cell_count:
    u8 sym_len, sym_len bytes UTF-8 (sym_len 0 = empty/skip cell)
    u32 fg, u32 bg (herdr packing, §1), u16 modifier, u8 flags (bit0 = skip)
```

A full frame is sent as `kind=1` with every row (x=0, cell_count=width). The TS
decoder is the single consumer. Golden bytes in `gui/tests/golden/*.bin` with
matching `.json` expectations prove that Rust and TS agree.

## 6. Frontend (vanilla TS, Vite)

Layout: a left sidebar (resizable 180–400 px), a top tab strip for the active
workspace, the center terminal canvas, and a bottom usage bar (24 px).

- **Sidebar.** Workspaces as collapsible groups, each with its tabs. Below them, the
  **Agents** list sorted by priority: `Blocked` > `Working` > `Done` > `Idle` >
  `Unknown`, then by `state_change_seq` descending (most recent first). Each row
  shows a status dot colour and a label; `Blocked` rows use an accent highlight.
  Clicking a tab → `api("tab.focus", …)`. Clicking an agent → focus its
  workspace, tab, and pane.
- **Actions** (toolbar + context menu): new workspace, new tab, split right, split
  down, close pane, close tab, close workspace. Close actions confirm in an inline
  popover, never `window.confirm`.
- **Terminal canvas.** Measure the monospace cell size once from the font and on DPR
  change. Map herdr colours to CSS: named → a 16-colour default palette constant,
  indexed → xterm 256 table, RGB → direct. Honour bold, italic, underline, reverse,
  and dim from `modifier`.
- **Input** (canvas focused):
  - Printable text and IME `compositionend` → `TextCommit`.
  - Enter, Backspace, Tab, Esc, arrows, Home/End, PgUp/PgDn, Delete, F1–F12, and
    Ctrl/Alt combinations → `Key` with `kind: Press`. Build the key mapping as a
    table in `src/input/keymap.ts`, taking `ClientKeyCode` variants and modifier
    bits from `wire.rs`.
  - Ctrl+Shift+V and a paste event → `Paste`.
  - Mouse click → hit-test the panes' `inner_rect`, then `pane.focus`. The mouse
    wheel is **out of scope** (Phase 2).
  - Input goes to the snapshot's focused pane.
- **Resize.** A `ResizeObserver` on the canvas → cols/rows from the cell size →
  `resize` (debounced 50 ms).
- **Usage bar.** `5h 14% · resets 1h52m │ 7d 1% · resets Thu 08:00 │ as of 3m ago`.
  - Colour thresholds: < 70 normal, 70–89 warning, ≥ 90 danger.
  - When `resets_at < now`, show that window as `5h — (reset)`.
  - `status: Missing` → `Claude usage: waiting for a Claude Code session`.
  - `Invalid` → `Claude usage: unreadable file`.
- **Connection banner.** `Unavailable` / `Disconnected` → a thin top banner
  `herdr server not reachable at <path> — retrying`.
- The first paint shows the chrome immediately (sidebar skeleton + usage bar), then
  the terminal when the first surface arrives. Call `report_ready` after two
  `requestAnimationFrame`s following the first chrome paint.

## 7. Out of scope for Phase 1 (do not build)

Per-pane cropping and restyled borders, file tree, editor, git diff, LSP, ADB,
Playwright, scrollback/mouse wheel, copy mode, text selection, hyperlinks,
kitty graphics, popups, notifications, settings UI, theming config, macOS/Linux
packaging (the code must still compile on unix: gate Windows-only code with
`#[cfg(windows)]`), and auto-update.

## 8. Do NOT touch

- Anything outside `gui/` and `docs/gui-phase1-spec.md`: herdr `src/`, the root
  `Cargo.toml`/`Cargo.lock`, `tests/`, `AGENTS.md`, and CI.
- `~/.claude/**` (settings, credentials, the statusline script). Only **read**
  `~/.claude/herdr-usage.json`.
- The user's **default** herdr session and its workspaces. Live tests use a
  dedicated session only (§10). Never close, create, or send input to panes in the
  default session.
- The installed herdr binary and its config.
- No git commits and no pushes. The main session commits after review.

## 9. Test harness (built first, runs in `npm run check`)

`npm run check` = `cargo fmt --check` + `cargo clippy --workspace -- -D warnings` +
`cargo test --workspace` (in `gui/`) + `tsc --noEmit` + `vitest run`.

1. **herdr-wire digest parity.** Rebuild each frozen digest value with
   `herdr-wire` types and assert the **same hex digest**, copied verbatim from
   herdr. Name each test `digest_<herdr_test_name>`.
   - The digests are at `src/protocol/wire.rs` lines 1946, 2165 (needs
     `WindowsKeyRecord`), 2356, 2373, 2390, 2595, 2642, 2703 (needs the bytes
     serializer), and 2963.
   - Also add the variant-tag tests `[20,0,0]` (`wire.rs:1920-1930`, 2708+).
2. **herdr-wire fixtures.** Parse `tests/fixtures/endpoint-{hello,welcome,snapshot}-v1.json`
   (read from the herdr repo root by relative path `../../../tests/fixtures`) into
   the JSON types and round-trip them. Unknown fields must be tolerated.
3. **Framing.** LE length prefix; over-size is rejected; trailing bytes are
   rejected; a bad payload between two good frames leaves the stream readable.
4. **Mirror.** Full apply; accepted patch; each rejection condition from §1
   (one test each); a rejection leaves the grid unchanged.
5. **Usage parser.** The full sample, missing windows, `spend_limit` present, float
   and int percentages, >100 clamped, garbage → `Invalid`, missing file →
   `Missing`, past `resets_at`.
6. **Fake herdr server** (integration test, `src-tauri/tests/fake_server.rs`). An
   in-process listener on a temp pipe/socket name speaks the framing. It asserts
   the client hello (codecs, `surface_delta:false`), sends welcome + snapshot
   fixture + a full frame + one patch + one bad patch, and asserts the mirror
   state and that the bad patch triggers a same-size `ClientShellResize`. It also
   answers one `ClientShellEndpointRequest`.
7. **Golden surface bytes.** Rust encodes fixtures → `tests/golden/*.bin`
   (generated by a test with `UPDATE_GOLDEN=1`, committed). Vitest decodes the same
   files and compares against `.json`.
8. **Vitest.** Decoder, grid mirror apply, agent priority sort (ties, unknown
   status), usage formatting (every case in §6), keymap table (the listed keys +
   modifiers), and colour mapping (named/indexed/RGB/reset).
9. **E2E smoke** (`npm run e2e`, **optional**, **not** in `check`, not required for
   Phase 1 done). WebdriverIO + `tauri-driver` + `msedgedriver` matching WebView2
   (153.x):
   - Launch against the test session.
   - Assert that the sidebar lists the test workspace and the canvas is non-blank.
   - Type `echo e2e-ok` + Enter, then check that
     `herdr --session gui-test pane read …` contains `e2e-ok`. The CLI **must** pass
     `--session gui-test`, or it reads the default session.
   - The script aborts unless the resolved client socket path contains
     `sessions\gui-test`.
10. **Startup bench** (`npm run bench:startup`). Build release, run 5 times with
    `HERDR_GUI_BENCH=1` against the test session, and print each run plus the
    median. Exit 1 if median `first_paint_ms ≥ 1000` or `attach_ms ≥ 300`.

## 10. Live check (manual + scripted), dedicated session only

1. Start an isolated server: `herdr --session gui-test server`. It runs in the
   **foreground** (`session.rs:54-81`, `main.rs:518,560`). Ship it as
   `gui/scripts/test-session.bat` for the user's own terminal. Never start it as a
   background process from an agent. Stop it with `herdr session stop gui-test`;
   remove it with `herdr session delete gui-test`. Paths:
   `%APPDATA%\herdr\sessions\gui-test\{herdr.sock,herdr-client.sock}`.
2. `gui/scripts/dev-test.bat` sets `HERDR_SESSION=gui-test` and runs
   `npm run tauri dev`. Both it and `bench:startup` abort unless the resolved client
   socket path contains `sessions\gui-test`.
3. Check: the tree shows; `echo hi` + Enter shows `hi`; new tab / split / close work;
   killing the test server shows the banner and reconnects after a restart; the
   usage bar matches `~/.claude/herdr-usage.json`.
4. Record the output of `npm run check`, `npm run bench:startup`, and the
   observations above in the report.

## 11. Risks and how this plan could be wrong

- **Protocol drift.** The installed server is 0.9.1. The repo is master (a breaking
  graphics change landed after v0.9.1: `c411883e`). Gen-1 codecs are frozen, so the
  endpoint lane should match. The digest tests prove it for master. The live check
  proves it for whichever server runs. If they disagree, target the fork-built
  server.
- **Geometry contention.** If the TUI and the GUI show the same tab, the last
  geometry controller wins the PTY size. Accepted for Phase 1.
- **Canvas 2D throughput.** If heavy output drops below 60 fps at 200×60, move the
  renderer to WebGL (Phase 2). The bench does not measure this. Record a manual
  `cat` of a large file.
- **Stale usage.** Numbers update only while a Claude Code session is active.
  The "as of" label makes that visible.

## 12. Roadmap after Phase 1 (planning only)

2. Sidebar restyle + per-pane cropping (the GUI draws its own borders), file tree,
   quick-open, and text search (`ignore` + `grep` crates).
3. Monaco editor for small edits.
4. Git diff (Monaco diff editor, `gix`).
5. LSP autocomplete (`monaco-languageclient`, backend-spawned servers).
6. ADB: screenshot, screen recording, then mirroring (scrcpy protocol + WebCodecs).
7. Playwright CLI runner + open-in-Chrome.
