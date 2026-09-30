# UI polish spec: pane chrome, close guard, agent list, text and contrast

Status: plan, 2026-09-30. Source: the Impeccable UI review of the Cowbell GUI.
Estimate: about 3 days for P1, 1 day for P2 and P3.

## 0. Goal and rules

This spec turns the review recommendations into 13 small slices. Each slice is one
commit-sized change. Each slice can be reverted alone.

Success criterion: `cd gui && npm run check` passes after each slice, and the live
check in §6 passes on a fresh portable build.

Rules for the implementer:

- Nothing outside `gui/` changes. herdr (the server in `../src`) stays untouched. The
  pane borders and the pane titles are cells that the herdr server draws
  (`src/ui/panes.rs:466-507` and `:635-685`). The GUI cannot restyle those cells. It
  can only draw DOM overlays on top of the canvas.
- Reuse existing helpers: `openMenu` (`ui/menu.ts`), `openOverlay`
  (`ui/overlay.ts`), `openConfirmPopover` (`ui/confirmPopover.ts`),
  `createStatusDot` (`ui/statusDot.ts`), `paneOverlayOrigin`
  (`mouse/overlayGeometry.ts`). Add no new npm or cargo dependency.
- No hard-coded colours in CSS or TS. Use the theme tokens (`themes/tokens.ts`). The
  only literals allowed are the ones that already exist (for example `#ffffff` on a
  danger hover).
- The working tree already holds uncommitted work (flutter run toolbar, tab dropdown).
  Do not revert it. Do not commit. List the files that each slice touches in your
  report, so the user can stage them.
- Already done, do not redo: "+" after the last tab, the chevron only on overflow,
  the anchored "All tabs" dropdown (`appTabStrip.ts:160-182`), and the menu
  `heading`/`status`/`null` dot support (`ui/menu.ts:20-22`, `:67-69`).

### Recommended implementation order

Priority is P1 > P2 > P3. Build in this order, because of file overlap:

1. S3 (close guard), S1 (focus ring), S2 (pane header), S5, S6, S7.
2. S8, S9, S11, S10.
3. S12, S13.

S2 depends on S1 (same module) and on S3 (`requestClosePane`). S5 depends on S9 only
for the shared `createStatusDotOrSlot` helper; if S9 is not in yet, S5 adds the
helper.

## 1. Slices overview

| Slice | Priority | Item | Main files |
|---|---|---|---|
| S1 | P1 | Pane focus ring and dim | `src-tauri/src/commands.rs`, `lib.rs`, new `src/paneChrome/*`, `appTerminalInput.ts`, `style.css` |
| S2 | P1 | Pane header strip | `src/paneChrome/*`, `appTypes.ts`, `appEvents.ts`, `style.css`; deletes `paneCloseButton.ts` |
| S3 | P1 | Pane close guard | new `src/workspace/paneClose.ts`, new `src/paneClose.ts`, 4 call sites, `ui/confirmPopover.ts` |
| S4 | P1 | Stray blue square | investigation only, §4 |
| S5 | P1 | Agents popover | `ui/statusbar.ts`, `appStatusBar.ts`, `style.css` |
| S6 | P1 | Text floor 12px | `style.css` |
| S7 | P1 | Secondary text contrast | `themes/dracula.ts`, `themes/tokyo-night.ts`, `themes/one-dark-pro.ts` |
| S8 | P2 | Shared pane/tab menu items | new `ui/paneActionItems.ts`, `shortcuts.ts`, `ui/menus.ts`, `ui/tabs.ts`, `ui/paneContextMenu.ts` |
| S9 | P2 | No idle dots (sidebar, agent list) | `ui/statusDot.ts`, `ui/sidebar.ts`, `style.css` |
| S10 | P2 | aria-labels on icon buttons | `index.html`, `appDom.ts` |
| S11 | P2 | Tab slot: fixed size, no idle dot | `ui/tabs.ts` |
| S12 | P3 | "herdr" menu label to Cowbell | `index.html`, `appMenuBar.ts`, `ui/shortcutsModal.ts` |
| S13 | P3 | Reduced motion, focus rings | `style.css` |

Count: P1 = 7 (S1 to S7), P2 = 4 (S8 to S11), P3 = 2 (S12, S13).

## 2. P1 slices

### S1 [P1] Pane focus: 2px accent ring, dimmed unfocused panes

**Facts.**

- The canvas is one surface for all panes. The Rust mirror knows each pane's
  `rect`, `inner_rect`, `scrollbar_rect` and `focused`
  (`crates/herdr-wire/src/server.rs:144-157`). The decoded frame in TS does not carry
  pane geometry (`decoder.ts`).
- Today only `split_focused_pane_rect` exposes geometry
  (`src-tauri/src/commands.rs:482-499`, registered at `lib.rs:77`).
- The server draws the focused pane's border in `palette.accent` and others in
  `palette.overlay0` (`../src/ui/panes.rs:496-503`). A pane has a border cell on a
  side only when the herdr config says so (`../src/ui/panes.rs:128-150`: borders only
  on multi-pane tabs by default, the shared right/bottom border is removed when
  `pane_gaps` is off, outer borders can be off).

**Design: a DOM overlay, never reserved rows.** The overlay reads geometry only. It
never changes the canvas size or the `resize` IPC, so the split and DPI maths
(`render/metrics.ts`, `renderer.measureAndResize`) stay untouched. Reserving rows is
not possible from the GUI: herdr computes the pane layout in cells on the server, and
one canvas paints all panes.

**Colour.** The ring uses `--focusBorder`. In Dark Modern (the user's theme, from
`%APPDATA%\herdr-gui\settings.json`) it is `#0078d4`, the same blue as the active tab
top border (`--tab-activeBorderTop`). Contrast on `--terminal-background` `#1f1f1f`
is 3.64:1 (UI component minimum 3:1). Do not use `--current-ws-color`.

**Rust contract** (`src-tauri/src/commands.rs`, next to `split_focused_pane_rect`):

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PaneLayoutEntry {
    pub pane_id: String,
    pub rect: PaneMouseRect,
    pub inner_rect: PaneMouseRect,
    pub scrollbar_rect: Option<PaneMouseRect>,
    pub focused: bool,
}

fn resolve_pane_layout(panes: &[PaneSurfacePane]) -> Vec<PaneLayoutEntry>;

/// Every pane of the current surface, in mirror order. Empty when there is
/// no surface or while a popup is present (the chrome must not draw over it).
#[tauri::command]
pub fn pane_layout(state: tauri::State<'_, AppState>) -> Vec<PaneLayoutEntry>;
```

- Register `commands::pane_layout` in `lib.rs` `generate_handler!`. No capability
  entry is needed (`capabilities/default.json` description: own commands are
  callable).
- Popup: `SurfaceMirror.had_popup` is private (`mirror.rs:76`). Add
  `pub fn has_popup(&self) -> bool`. `pane_layout` returns an empty `Vec` when it is
  true.
- Rust test: `pane_layout_lists_every_pane_with_focus` (two panes, one focused,
  checks order, rects and `focused`), and `pane_layout_is_empty_without_panes`. Reuse
  the `pane()`/`rect()` test helpers (`commands.rs:~728-760`).

**TS pure contract** (new `src/paneChrome/geometry.ts`, unit-tested):

```ts
import type { CellRect } from "../mouse/geometry";

export interface LayoutPane {
  pane_id: string;
  rect: CellRect;
  inner_rect: CellRect;
  scrollbar_rect: CellRect | null;
  focused: boolean;
}

/** Fractional cell box. Its edges sit on the centre of the border line that the
 * server draws, so the 2px ring covers that line instead of doubling it. */
export interface CellBox { left: number; top: number; right: number; bottom: number }

export function ringBox(pane: LayoutPane, panes: readonly LayoutPane[]): CellBox;
```

Rules for `ringBox`. Let `content` be the union of `inner_rect` and
`scrollbar_rect`. Let `rectRight = rect.x + rect.width`, `rectBottom = rect.y +
rect.height`, `contentRight = content.x + content.width`, `contentBottom = content.y
+ content.height`.

- `left = content.x > rect.x ? content.x - 0.5 : rect.x`.
- `top = content.y > rect.y ? content.y - 0.5 : rect.y`.
- `right = contentRight < rectRight ? contentRight + 0.5 : (neighbourBorderAt("x",
  rectRight) ? rectRight + 0.5 : rectRight)`.
- `bottom`: the same rule on the y axis.
- `neighbourBorderAt("x", edge)` is true when another pane `p` has `p.rect.x ===
  edge`, overlaps this pane's rows, and `p.inner_rect.x > p.rect.x` (it owns a left
  border cell). This covers `pane_gaps = false`, where the server removes this pane's
  right border and draws the shared line as the neighbour's left border.

**TS DOM module** (new `src/paneChrome/paneChrome.ts`):

```ts
/** Re-reads `pane_layout` and redraws the ring, the dim layers and (S2) the
 * headers. Coalesced: at most one IPC in flight, one trailing call. */
export function refreshPaneChrome(): void;
```

- Copy the coalescing pattern from `paneCloseButton.ts:46-61` (`inFlight`/`pending`).
- CSS px maths: take `paneOverlayOrigin({ x: 0, y: 0, width: 0, height: 0 },
  renderer)` (`mouse/overlayGeometry.ts:23-35`). A cell coordinate `c` maps to
  `originLeft + c * cellWidthCss` (x) and `originTop + c * cellHeightCss` (y). This is
  the same maths as the selection overlay, so DPR and the integral-origin shift stay
  correct.
- DOM: one container `<div class="pane-chrome">` appended to `terminalWrapEl`, with
  `position: absolute; inset: 0; pointer-events: none`. Children:
  - `.pane-ring`, one, for the focused pane. Left `= x(box.left) - 1`, top `=
    y(box.top) - 1`, width `= (box.right - box.left) * cellWidthCss + 2`, height the
    same on y (`box-sizing: border-box`, so the 2px border is centred on the line).
  - `.pane-dim`, one per unfocused pane, over its `rect`.
  - Draw nothing when the layout has fewer than 2 panes.
- Skip DOM writes when nothing changed: build a key string from the layout JSON, the
  cell CSS size and the origin; return early when it equals the last key.
- Call `refreshPaneChrome()` next to the two existing `refreshPaneCloseButton()`
  calls (`appTerminalInput.ts:104` after resize, `:156` after each surface frame).

**CSS** (`style.css`, a new block after the `.pane-close-button` block, ~line 1777):

```css
.pane-chrome { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.pane-ring { position: absolute; box-sizing: border-box; border: 2px solid var(--focusBorder); border-radius: 2px; }
.pane-dim { position: absolute; background: var(--terminal-background); opacity: 0.15; }
```

`opacity: 0.15` of the background colour over the canvas shows the pane content at
about 85%. Terminal text stays readable: `#cccccc` at 85% on `#1f1f1f` is 7.9:1.

**Edge cases.**

- Single pane, or a zoomed tab (the mirror then holds one pane): no ring, no dim.
- Borders off (`pane_borders = off`, `../src/config/model.rs:863-869`): `content`
  equals `rect`, the ring sits on the rect edge. That is correct: there is no server
  line to cover.
- Font size or DPR change: `scheduleResize` (`appTerminalInput.ts:97-108`) already
  calls the refresh after `measureAndResize`.
- Surface not yet received, or a popup: `pane_layout` returns `[]`; clear the
  container.
- The selection, find and copy-mode overlays have no `z-index`. The dim layer
  (z-index 1) sits above them, so they dim by 15% on unfocused panes. Accept this;
  those overlays live on the focused pane in practice.
- Performance: one IPC per surface frame, the same cost as today's
  `split_focused_pane_rect` call. The key check removes DOM churn.

**Tests.** `tests/unit/paneChrome/geometry.test.ts`:

- Two panes side by side, both with all borders (`pane_gaps` on): each ring edge is
  at `content ± 0.5`.
- Two panes side by side, shared line (`pane_gaps` off: left pane has no right
  border, right pane has a left border): the left pane's `right` is `rectRight + 0.5`.
- No borders at all: the box equals `rect`.
- A pane with a scrollbar column: `right` uses the scrollbar's right edge.

### S2 [P1] Pane header strip

**Facts.**

- `paneCloseButton.ts` puts a 20px ✕ at the focused pane's top-right on a split tab.
  It calls `pane.close` directly (`:37`). Its position math is at `:62-78`.
- The server writes the pane title into the top border row: `" <label> "` from
  column `rect.x + 1` (`../src/ui/panes.rs:25-32`, `:659-684`). Unfocused titles use
  `overlay0` and are hard to read.
- Zoom is per tab. The snapshot JSON already carries `ClientShellTab.zoomed`
  (`crates/herdr-wire/src/server.rs:448`). `RawTab` (`appTypes.ts:30-36`) does not
  declare it yet.
- The find bar and the copy-mode badge sit at `top: 8px; right: 8px` of
  `#terminal-wrap` (`style.css:1782-1795`, `:1821-1835`).
- Split lines can be dragged to resize; the server hit-tests them
  (`PaneSurfaceSplit.hit_rect`, `server.rs:166-172`). The header must not take
  pointer events on the border row, except on its buttons.

**Layering decision.** The header is a DOM overlay on the pane's existing top border
row. It reserves no rows. Tradeoff: the buttons (24px) are taller than one cell (about
17-19px at 13-14px font), so they overlap about 3px of the rows above and below the
border row at the pane's right end. The chosen alternative (reserve a row) needs a
herdr server layout change and breaks `inner_rect`, mouse and resize maths, so it is
rejected.

**Pure contracts** (add to `src/paneChrome/geometry.ts`):

```ts
import type { Grid } from "../grid";

/** The title the server drew into the pane's top border row, read back from the
 * grid so the DOM label shows the same text. `null` when the pane has no top border
 * or no title. `cells` is the width in cells of the drawn `" label "` run. */
export function borderTitle(grid: Grid, pane: LayoutPane): { text: string; startCol: number; cells: number } | null;

export type HeaderMode = "strip" | "pill" | "none";
/** strip: the pane has a top border row (content.y > rect.y).
 *  pill: no top border row, the pane is focused and its tab is zoomed.
 *  none: otherwise. */
export function headerMode(pane: LayoutPane, tabZoomed: boolean): HeaderMode;
```

`borderTitle` rules: row `rect.y`; scan columns `rect.x + 1` up to
`rect.x + rect.width - 2`; skip `skip` cells (wide-char tails); stop at the first
symbol in U+2500-U+257F (box drawing). `text` is the trimmed run. Return `null` when
the trimmed text is empty or `headerMode` would not be `"strip"`.

**DOM** (extend `refreshPaneChrome`; one header per pane whose mode is not `none`):

```html
<div class="pane-header [is-focused] [is-hovered]" data-pane-id="…">
  <span class="pane-header__title">claude</span>          <!-- strip only -->
  <div class="pane-header__actions">
    <button class="pane-header__zoomed">…Zoomed</button>  <!-- only when the tab is zoomed -->
    <button class="pane-header__btn" data-action="splitRight"><i class="codicon codicon-split-horizontal"></i></button>
    <button class="pane-header__btn" data-action="splitDown"><i class="codicon codicon-split-vertical"></i></button>
    <button class="pane-header__btn pane-header__btn--close" data-action="close"><i class="codicon codicon-chrome-close"></i></button>
  </div>
</div>
```

- Header box: left `x(ringBox.left)`, right `x(ringBox.right)`, vertical centre on the
  centre of row `rect.y` (strip), or top `y(content.y) + 2px` (pill).
- Title: left at column `startCol`, `min-width` = `cells * cellWidthCss`, so it
  covers the server-drawn title fully. `max-width` stops 8px before the actions.
  Background `--terminal-background`, `pointer-events: none`, ellipsis.
  Colour: focused `--foreground` (10.26:1 on `#1f1f1f`), unfocused
  `--descriptionForeground` (6.08:1). Font: `--ui-font`, 12px (`var(--fs-xs)` once S6
  is in), weight 600 when focused.
- Actions: right-aligned 4px inside the ring. Background `--terminal-background`.
  `pointer-events: auto`. Each button is 24×24, `border-radius: 4px`, icon 14px,
  `tabIndex = -1` (keyboard users have the shortcuts).
- Tooltips and aria-labels use `shortcutDisplay()` (exported from `shortcuts.ts` in
  S8; if S8 is not in yet, read `SHORTCUTS` the same way `ui/menus.ts:13-15` does):
  `Split Right (Alt+Shift+=)`, `Split Down (Alt+Shift+-)`, `Close Pane (Alt+Shift+W)`,
  `Restore from zoom (Alt+Shift+Z)` (`shortcuts.ts:127-153`).
- The close glyph is `codicon-chrome-close`, different from the tab ✕
  (`codicon-close`, `ui/tabs.ts:245`).
- Visibility: focused header actions always show. Unfocused header actions show only
  while `.is-hovered`. Hidden actions use `visibility: hidden`, so they cannot take a
  click.
- Hover: one `pointermove` listener and one `pointerleave` listener on
  `terminalWrapEl`, wired once. They compare the pointer against the cached CSS rects
  of the last layout (no IPC) and toggle `.is-hovered`. After a rebuild, re-apply
  hover from the last pointer position.
- Clicks: `pointerdown` calls `event.stopPropagation()` (as `paneCloseButton.ts:34`
  does). `click`:
  - `splitRight`/`splitDown`: `api("pane.split", { direction, target_pane_id: paneId,
    focus: true })` (the same call as `appTerminalMouse.ts:672-673`).
  - `close`: `requestClosePane(paneId, buttonEl)` (S3).
  - Zoomed badge: `api("pane.zoom", { pane_id: paneId })`.
  - Then `focusKeyboardCapture()`.
- Find bar offset: when any rendered header touches cell row 0, set
  `terminalWrapEl.style.setProperty("--pane-chrome-top", `${Math.max(24, cellHeightCss) + 4}px`)`,
  else `0px`. In CSS: `.find-bar, .copy-mode-badge { top: calc(8px +
  var(--pane-chrome-top, 0px)); }`.
- Zoom source: `appState.snapshot?.tabs.find((t) => t.focused)?.zoomed === true`.
  Add `zoomed?: boolean` to `RawTab` (optional: an older server may omit it).
- Snapshot refresh: call `refreshPaneChrome()` in the snapshot listener
  (`appEvents.ts:~39`, next to `renderTabsNow()`), so the Zoomed badge follows a zoom
  change that does not change the layout key. Add `zoomed` and the titles to the key.

**CSS.**

```css
.pane-header { position: absolute; display: flex; align-items: center; pointer-events: none; font: 600 12px var(--ui-font); }
.pane-header__title { position: absolute; background: var(--terminal-background); color: var(--descriptionForeground); padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pane-header.is-focused .pane-header__title { color: var(--foreground); }
.pane-header__actions { margin-left: auto; display: flex; gap: 2px; background: var(--terminal-background); pointer-events: auto; visibility: hidden; }
.pane-header.is-focused .pane-header__actions,
.pane-header.is-hovered .pane-header__actions { visibility: visible; }
.pane-header__btn { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 4px; color: var(--icon-foreground); }
.pane-header__btn .codicon { font-size: 14px; }
.pane-header__btn:hover { background: var(--list-hoverBackground); }
.pane-header__btn--close:hover { background: var(--herdr-danger); color: #ffffff; }   /* same as .ws-close:hover, style.css:454-458 */
.pane-header__zoomed { height: 20px; padding: 0 6px; border: 1px solid var(--focusBorder); border-radius: 4px; font-size: 12px; }
```

White on `--herdr-danger` `#c72e0f` is 5.49:1.

**Removed in this slice.** `src/paneCloseButton.ts`, its two calls
(`appTerminalInput.ts:11`, `:104`, `:156`), its CSS (`style.css:1754-1776`), and
`split_focused_pane_rect` with its test (`commands.rs:482-499`, `:766-776`,
`lib.rs:77`). The header's close button replaces it. Reverting S2 restores all of
them.

**Edge cases.**

- A header on the lower pane of a down-split sits on the horizontal split line. Its
  buttons cover a short piece of that line, so a resize drag must start elsewhere on
  the line. Accept.
- `pane_border_title` returns nothing for `rect.width <= 4` (`../src/ui/panes.rs:27`):
  no title; still render actions when the ring width is at least 3 buttons + 8px,
  else render no header.
- Single pane on an unzoomed tab with default borders: no top border row, mode
  `none`, no header. Split buttons stay in the menus and shortcuts. (Open question 2.)
- `pane_borders = always` on a single pane: mode `strip`, header shows.
- A long title: ellipsis at the actions.
- The perf HUD (`#perf-hud`, top-right, dev only) can overlap the pill. Accept.

**Tests.** Add to `tests/unit/paneChrome/geometry.test.ts`:

- `borderTitle` reads `" claude "` after `─` cells and returns `{ text: "claude",
  startCol: rect.x + 1, cells: 8 }`; stops at the first box-drawing cell; skips wide
  tails; returns `null` with no top border.
- `headerMode`: strip with a top border; pill for focused + zoomed with no border;
  none for unfocused + zoomed; none for a single unzoomed pane with no border.

### S3 [P1] Pane close guard

**Facts.**

- Every Close Pane path calls `pane.close` at once: `appMenuBar.ts:128-131` (Pane
  menu and Alt+Shift+W, via `:383`), `appTabStrip.ts:127-133` (tab context menu),
  `appTerminalMouse.ts:675` (pane context menu), `paneCloseButton.ts:37`.
- herdr closes the workspace when the closed pane is the last pane of the last tab
  (`../src/app/api/panes.rs:1878-1898`). The tab path already guards that case
  (`tabClose.ts:22-44`, `workspace/lastTab.ts`).
- `openConfirmPopover` puts the popover to the right of the anchor with no clamp
  (`ui/confirmPopover.ts:57-62`). A pane at the right edge puts it off screen.

**Pure contract** (new `src/workspace/paneClose.ts`):

```ts
import type { RawAgent, RawPane, RawTab } from "../appTypes";

export type PaneCloseDecision =
  | { kind: "close" }
  | { kind: "confirmAgent"; agentName: string; status: "working" | "blocked" }
  | { kind: "closeTab"; tabId: string };

export interface PaneCloseSnapshot {
  panes: readonly Pick<RawPane, "pane_id" | "tab_id">[];
  tabs: readonly Pick<RawTab, "tab_id" | "workspace_id">[];
  agents: readonly RawAgent[];
}

export function paneCloseDecision(paneId: string, snapshot: PaneCloseSnapshot): PaneCloseDecision;

/** The confirm body line. */
export function paneCloseDetail(agentName: string, status: "working" | "blocked"): string;
```

Rules, in order:

1. The pane is not in `snapshot.panes`: `close` (the server reports the error).
2. The pane is the only pane of its tab, and `workspaceClosedByTabClose(tabs, tabId)`
   is not `null`: `closeTab`. The caller runs `requestCloseTab(tabId, anchor)`, which
   shows the workspace confirm that already names every agent.
3. An agent row for the pane has `agent_status` `working` or `blocked`:
   `confirmAgent` with `agentDisplayName(agent)` (`agentText.ts:6-8`).
4. Otherwise (`idle`, `done`, `unknown`, no agent, a plain shell): `close`.

`paneCloseDetail`: working gives `"<agent> is working. Closing the pane stops it."`;
blocked gives `"<agent> is waiting for your input. Closing the pane stops it."`.

**Glue** (new `src/paneClose.ts`, next to `tabClose.ts`):

```ts
/** Close a pane; a pane with a working or blocked agent confirms first. */
export function requestClosePane(paneId: string, anchor?: HTMLElement | null): void;
```

- `confirmAgent`: `openConfirmPopover(overlayRoot, anchor ?? canvas, { titlePrefix:
  "Close the pane running ", titleName: agentName, titleSuffix: "?", detail:
  paneCloseDetail(...), confirmLabel: "Close pane", onConfirm: () => api("pane.close",
  { pane_id }) })`. Cancel keeps its default focus.
- Route all four call sites above through `requestClosePane`. The pane context menu
  passes no anchor (the popover lands at the canvas); the tab strip passes nothing
  too.

**Confirm popover clamp** (`ui/confirmPopover.ts`, after `root.appendChild(popover)`):
when `popover.offsetLeft + popover.offsetWidth > root.clientWidth - 8`, set `left =
max(8, root.clientWidth - popover.offsetWidth - 8)`. This changes nothing for
today's callers, which open near the sidebar or the tab strip.

**Tests.** `tests/unit/paneClose.test.ts`:

- Working agent in a split tab: `confirmAgent`, `status: "working"`, the display name.
- Blocked agent: `confirmAgent`, `status: "blocked"`.
- Idle, done, unknown, and no agent: `close`.
- The only pane of the only tab: `closeTab`, even with a working agent.
- The only pane of one of two tabs, with a working agent: `confirmAgent`.
- Unknown pane id: `close`.
- `paneCloseDetail` for both statuses.

### S4 [P1] Stray blue square (about 22px, mid-pane, focused pane): investigation only

Do not change code for this item. Collect evidence first.

**Ranked hypotheses.**

1. **A retained mouse selection highlight (most likely).** A drag of one or two cells
   sets `dragged` (`appTerminalMouse.ts:418`) and finishes a selection
   (`:444-455`). The highlight is one `.terminal-selection-row` div per row, filled
   with `--terminal-selectionBackground` `#264f78` (blue) at `opacity: 0.5`
   (`style.css:700-705`). A 2-3 cell selection is about 16-26px wide and one cell
   (about 17-19px) high: a small blue square. The divs sit at fixed CSS px
   (`mouse/selectionOverlay.ts:49-55`). They clear only on the next pointerdown
   (`appTerminalMouse.ts:246-247`), on input (`:581-584`), or on a click with no drag
   (`:458-462`). They do not move or clear on output scroll, resize, tab switch or
   workspace switch. So the square can outlive the text it marked and float
   mid-pane. A double-click on a short word does the same (`startWordSelection`,
   `:494-515`).
2. **App-drawn content.** The agent's own TUI (for example Claude Code) paints cells
   with a blue background (an inverse cursor, a badge). Then the square is canvas
   content from the server, not a GUI bug.
3. **The "Copied" toast at the pointer.** `#copy-notice.is-at-pointer` has a
   `--focusBorder` blue border and appears near the pointer after a selection
   (`copyNotice.ts:28-40`, `style.css:1452-1456`). It carries the word "Copied" and
   fades after 2 s, so it matches less well.
4. **Copy-mode cursor or find match.** `.terminal-copymode-cursor` and
   `.terminal-find-match-row` (`style.css:1814-1848`) are pane overlays too, but they
   need an active mode and are not blue in Dark Modern. Unlikely.
5. **The terminal cursor.** Dark Modern's cursor is `#cccccc`
   (`themes/dark-modern.ts:49`), not blue, and it blinks. Unlikely.

**Repro recipe (hypothesis 1).**

1. Run Cowbell, focus a pane with scrolling output (for example `ping -t localhost`).
2. Press the left button, move one or two cells, release. A "Copied" toast shows.
3. Wait for output to scroll, or switch tab and back.
4. Expected with hypothesis 1: a blue block stays at the same screen spot while the
   text moves under it.

**Evidence needed.**

- With the square visible, in WebView2 DevTools (Ctrl+Shift+I in a dev build):
  `document.elementsFromPoint(x, y)` at the square's centre, and
  `document.querySelectorAll(".terminal-selection-row").length`. A `.terminal-selection-row`
  hit confirms hypothesis 1.
- Does one click in the terminal remove it? Yes points to hypothesis 1 or 4.
- Does it scroll with the text? Yes points to hypothesis 2. Then capture
  `herdr agent read <pane> --source detection --format ansi` for that pane.
- Does it blink? Yes points to hypothesis 5.

Only after that evidence, write a fix spec. For hypothesis 1 the likely fix is "clear
the selection overlay on tab/workspace switch and when `content_revision` moves", but
that is a hypothesis, not a plan.

### S5 [P1] Agents popover

**Facts.** `openAgentPopover` sets `left: 6px; bottom: 30px` and no max height
(`ui/statusbar.ts:489-492`, `style.css:1191-1194`). Each row has two lines: line 1 is
`workspace · tab` (`:396-398`), line 2 is `formatAgentRowLine2` (`:402-405`). Groups
are Needs you, Done, Working, Idle (`:446-451`), each with a header (`:564-576`).
`scrollAgentPopoverToStatusGroup` finds a row by its dot class
(`appStatusBar.ts:151-163`).

**Changes.**

- **Anchor.** Add `anchor?: HTMLElement` to `OpenAgentPopoverOptions`. With an anchor:
  `left = anchorRect.left - rootRect.left`, `bottom = rootRect.bottom - anchorRect.top
  + 4`. Pass `statusAgentCountsEl` from `appStatusBar.ts` (both open paths). Without
  an anchor, keep today's `6px`/`30px`.
- **Height.** `.agent-popover { max-height: min(60vh, 520px); overflow-y: auto; }`.
- **One line per row.** New row DOM (replaces `buildAgentRowEl`'s body):

  ```html
  <div class="agent-row" data-pane-id="…" data-status="working" tabindex="0"
       title="claude · working 12m · Review migration plan · herdr · tab 2">
    <span class="status-dot status-dot--working"></span>   <!-- or .status-dot-slot for idle/unknown -->
    <span class="agent-row__main">Review migration plan</span>  <!-- title ?? agentName -->
    <span class="agent-row__ws" style="--ws-chip: #2dd4bf">herdr</span>
    <span class="agent-row__meta">12m</span>                  <!-- formatAge; omitted when "" -->
  </div>
  ```

  - `title` attribute: `formatAgentRowLine2(...)` + `` ` · ${workspace_label} · ${tab_label}` ``.
    Keep `formatAgentRowLine2` and its tests.
  - Grid: `grid-template-columns: 12px minmax(0, 1fr) auto auto; column-gap: 8px;
    align-items: center`. `.agent-row__main` truncates with an ellipsis.
  - `.agent-row__ws`: the workspace label as a chip. `max-width: 96px`, ellipsis,
    `font-size: 12px`, `padding: 0 6px`, `border-radius: 3px`,
    `border-left: 3px solid var(--ws-chip, var(--descriptionForeground))`,
    `background: var(--list-hoverBackground)`. No colour picked: the neutral bar.
  - `.agent-row__meta`: 12px, `--descriptionForeground`.
  - Highlight (done) cards: the same one-line row. `.agent-row__done-label` ("DONE ·
    just now") takes the meta slot. Drop the "Enter ↵ jump" hint; Enter still works.
  - Drop the row's old `line1`/empty span/`line2` and the `.agent-row > span:nth-child(2)`
    rule (`style.css:1493-1498`) and the two `.agent-row.is-highlight …` grid rules
    (`:1500-1512`).
- **Idle collapsed.** The Idle group (idle + unknown) renders as one summary row, not a
  header plus rows: `<div class="agent-popover__idle-summary" role="button"
  tabindex="0" aria-expanded="false"><i class="codicon codicon-chevron-right"></i>7
  idle</div>`. Click, Enter or Space toggles. Expanded, the chevron is
  `chevron-down` and the idle rows follow. Needs you, Done and Working stay expanded
  with their headers.
  - Keep the state in a `let idleExpanded = false` inside `openAgentPopover`, outside
    `renderContent`, so a `refreshOpenAgentPopover` keeps it.
  - Push the summary row into `rowEls`, so ArrowUp/ArrowDown reach it.
- **No idle dot.** Idle and unknown rows get an empty `.status-dot-slot` (S9 helper)
  instead of a hollow dot.
- **Group headers** at 12px (S6 token).
- **Scroll to group** (`appStatusBar.ts:155-157`): find the row by
  `.agent-row[data-status="${status}"]`. For `idle`, first click the summary row when
  its `aria-expanded` is `"false"`.

**Edge cases.** No idle agents: no summary row. Only idle agents: the popover shows only
the summary row, collapsed. A pinned popover keeps its behaviour (`:594-630`). The
counts element can be empty (width 0): the anchor still gives the left edge.

**Tests** (`tests/unit/ui/agentPopover.test.ts`):

- Update "renders a group header … in Needs You/Done/Working/Idle order" (`:199`): Idle
  is now a summary row with text `"N idle"`, not a header.
- New: idle rows are hidden until the summary is clicked; `aria-expanded` flips.
- New: the expansion survives `refreshOpenAgentPopover`.
- New: an idle row has no `.status-dot`; a working row has one.
- New: `.agent-row__main` shows the title, or the agent name without a title.
- New: `.agent-row__ws` shows the workspace label; each row has `data-status`.
- New: with `anchor`, `style.left` equals the anchor's left minus the root's left
  (stub `getBoundingClientRect`).

### S6 [P1] Text floor: `--fs-xs: 12px`

Add `--fs-xs: 12px;` to `:root` (`style.css:10-15`). Replace these sub-12px rules with
`font-size: var(--fs-xs);`:

| Line | Selector | Was |
|---|---|---|
| 317 | `.sidebar-header` | 11px |
| 479 | `.sidebar-footer__hint` | 11px |
| 631 | `.menu-heading` | 11px |
| 823 | `#perf-hud` | 11px |
| 1200 | `.agent-popover__header` | 11px |
| 1230 | `.agent-popover__group-header` | 10px |
| 1270 | `.agent-row .agent-row__meta` | 11px |
| 1283 | `.agent-row.is-highlight .agent-row__done-label` | 11px |
| 1296 | `.agent-popover__footer` | 11px |
| 1356 | `.licenses-modal-notices` | 11px |
| 1382 | `.shortcuts-modal-group` | 11px |
| 1473 | `.status-agent-counts__as-of` | 11px |
| 1638 | `.wizard-log` | 11px |
| 1652 | `.wizard-tag` | 11px |
| 1719 | `.wizard-provider-card__meta` | 11px |

Line numbers are from the working tree on 2026-09-30; S1/S2 CSS additions shift the
lines after ~1777 only. Not changed: `--terminal-font-size` and the canvas font
(`render/renderer.ts`), codicon sizes (`.codicon` 12px at `:220`, `:425` are icons).

Layout check: `.sidebar-header` is 22px high (`:313`); 12px × 1.4 = 16.8px fits. The
status bar is 22px (`:839`) and already uses 12px. The tab height (35px, `:522`) and
the 44px sidebar row do not use these rules.

Check: `rg -n "font-size: 1[01]px" gui/src/style.css` returns nothing.

### S7 [P1] Secondary text contrast

Measured with WCAG 2.x relative luminance on the token hex values
(`themes/*.ts`). Secondary text is `descriptionForeground`; it is also
`tab.inactiveForeground` (`themes/build.ts:115`, `:124`). The inactive tab label, the
sidebar branch line (`.ws-meta`, `style.css:402-405`) and the shortcut hints
(`.menu-item__key` `:1009-1013`, `.sidebar-footer__hint` `:477-480`) all use it.

| Theme | desc | on sidebar/tabs | on menu | on hover | on terminal bg |
|---|---|---|---|---|---|
| Dark Modern (default) | `#9d9d9d` | 6.55 | 6.08 | 5.12 | 6.08 |
| herdr | `#8a8a8a` | 5.43 | 5.24 | 4.94 | 5.67 |
| Catppuccin Mocha | `#a6adc8` | 7.89 | 7.89 | 6.67 | 7.37 |
| One Dark Pro | `#7f848e` | **4.10** | **4.10** | **3.48** | **3.73** |
| Dracula | `#6272a4` | **3.36** | **3.36** | **2.51** | **3.03** |
| Tokyo Night | `#565f89` | **2.91** | **2.91** | **2.60** | **2.76** |

Dark Modern already passes, so the token the user sees today does not change. Lift
only the three failing palettes' `desc`, mixed toward white only as far as the lowest
pair reaches 4.5:1:

| File | Line | Old | New | Min ratio |
|---|---|---|---|---|
| `themes/one-dark-pro.ts` | 13 | `#7f848e` | `#9398a0` | 4.50 (hover) |
| `themes/dracula.ts` | 13 | `#6272a4` | `#95a0c2` | 4.54 (hover) |
| `themes/tokyo-night.ts` | 13 | `#565f89` | `#8087a7` | 4.54 (hover) |

Imported VS Code themes are not changed.

**Test.** New `tests/unit/themes/contrast.test.ts`. A local `contrastRatio(a, b)`
helper in the test file (no production code). For every built-in theme (resolve keys
with `resolveThemeColor`), `descriptionForeground` against `sideBar.background`,
`menu.background`, `list.hoverBackground` and `terminal.background` is at least 4.5.

## 3. P2 slices

### S8 [P2] One shared builder for pane and tab actions

**Facts.** Three menus build the same actions three ways: `ui/menus.ts:138-162` (Pane
menu, shortcuts from `SHORTCUTS`), `ui/tabs.ts:162-199` (tab context menu, shortcut
strings hard-coded, no Close Tab, "Rename…" instead of "Rename Tab…"),
`ui/paneContextMenu.ts:36-47` (no shortcuts, no icon on Toggle Zoom).

**Contracts.**

- Move `shortcutDisplay` from `ui/menus.ts:13-15` to `shortcuts.ts` and export it:
  `export function shortcutDisplay(id: string): string | undefined`.
- New `src/ui/paneActionItems.ts`:

```ts
import type { MenuItemSpec } from "./menu";

export interface PaneLayoutHandlers { onSplitRight(): void; onSplitDown(): void; onToggleZoom(): void }
export interface CloseHandlers { onClosePane?(): void; onCloseTab?(): void }

/** Split Right, Split Down, Toggle Zoom. The first item carries separatorBefore. */
export function paneLayoutItems(h: PaneLayoutHandlers): MenuItemSpec[];
/** Close Pane (danger), then Close Tab. An item is left out when its handler is
 * missing. The first item carries separatorBefore. */
export function closeItems(h: CloseHandlers): MenuItemSpec[];
```

| id | label | icon | shortcut | danger |
|---|---|---|---|---|
| `pane.splitRight` | Split Right | `split-horizontal` | `shortcutDisplay("pane.splitRight")` | |
| `pane.splitDown` | Split Down | `split-vertical` | `shortcutDisplay("pane.splitDown")` | |
| `pane.toggleZoom` | Toggle Zoom | `screen-full` | `shortcutDisplay("pane.toggleZoom")` | |
| `pane.close` | Close Pane | `chrome-close` | `shortcutDisplay("pane.close")` | yes |
| `tab.close` | Close Tab | `close` | `shortcutDisplay("tab.close")` | |

- Pane menu (`ui/menus.ts`): `[...paneLayoutItems(ctx), ...closeItems({ onClosePane:
  ctx.onClosePane }), Clear (separatorBefore)]`. Close Tab stays in the Tab menu only.
- Tab context menu (`ui/tabs.ts`): `[...paneLayoutItems(...), Rename Tab… (F2,
  separatorBefore), ...closeItems({ onClosePane: paneCount > 1 ? … : undefined,
  onCloseTab: () => callbacks.onCloseTab(tab.tab_id) })]`. `onCloseTab` already goes
  through `requestCloseTab` (`appTabStrip.ts:83-86`).
- Pane context menu (`ui/paneContextMenu.ts`): Copy, Paste, Select All, Clear, then
  `paneLayoutItems`, then the passthrough toggle (separatorBefore), then
  `closeItems({ onClosePane })`.
- No two items in one menu share a label, and one action has one label in every menu.

**Tests.** New `tests/unit/ui/paneActionItems.test.ts`: labels, icons, `danger` only
on Close Pane, shortcuts equal `SHORTCUTS` display strings, items left out without a
handler. Update `tests/unit/ui/tabs.test.ts` (`:241-262`): Close Tab is present. The
existing `paneContextMenu.test.ts` label checks (`:46-61`) must still pass.

### S9 [P2] No idle dots in sidebar rows and the agent list

- `ui/statusDot.ts`: add

  ```ts
  /** A status dot, or an empty slot of the same size for idle/unknown (no news). */
  export function createStatusDotOrSlot(status: AgentStatus): HTMLElement;
  ```

  The slot is `<span class="status-dot-slot" aria-hidden="true"></span>`. CSS:
  `.status-dot-slot { width: 8px; height: 8px; display: inline-block; flex-shrink: 0; }`.
- `ui/sidebar.ts:163`: use `createStatusDotOrSlot`. The `.ws` grid column stays 18px
  (`style.css:344`), so names do not move.
- The agent list uses it in S5. The status-bar count items keep their dots, because
  there the dot is the legend for "N idle".
- Do not add hidden text for the idle state. The absence of a dot means "no news",
  the same as the tab dropdown (`appTabStrip.ts:165-166`).

**Test.** `tests/unit/ui/sidebar.test.ts`: an idle workspace row has no `.status-dot`
and has one `.status-dot-slot`; a blocked row has `.status-dot--blocked`.

### S10 [P2] aria-labels on icon-only buttons

- `index.html:64-69`: change `#tab-plus` and `#tab-overflow` from `<div tabindex="0">`
  to `<button type="button">`. Add `aria-label="New Tab"` and `aria-label="All Tabs"`
  plus `aria-haspopup="menu"` on the chevron. Native buttons give Enter/Space for
  free; today Enter on these divs does nothing (`appTabStrip.ts:191-192` wires
  `click` only).
- `appDom.ts:13-14`: cast both to `HTMLButtonElement`.
- `index.html:44-49`: add `aria-label="New Workspace"` to
  `#sidebar-new-workspace-btn`.
- Window buttons already have `aria-label` (`index.html:26-34`): verify only.
- The tab dropdown: `openMenu` already sets `role="menu"`/`role="menuitem"`
  (`ui/menu.ts:43`, `:135`) and handles ArrowUp/ArrowDown (`:249-252`, `:317-322`):
  verify only.
- Add `.tab-plus:focus-visible, .tab-overflow:focus-visible` to the focus-ring list
  (`style.css:70-80`), unless S13 lands first.

### S11 [P2] Tab slot: fixed size, no idle dot

- The slot is already a fixed 20×20 box (`style.css:558-565`); the ✕ and the dot swap
  inside it, so the label does not shift. Keep it.
- The tab strip still draws a hollow dot for idle tabs (`ui/tabs.ts:241-243`), unlike
  the dropdown. Use `createStatusDotOrSlot(dotStatus)` there (S9 helper; add it here if
  S9 is not in).
- Update `tests/unit/ui/tabs.test.ts:178-185`: use a `working` tab for the role/label
  check, and add "an idle tab has a `.status-dot-slot` and no `.status-dot`".

## 4. P3 slices

### S12 [P3] Top menu "herdr" becomes "Cowbell"

- The label is text only: `index.html:17-19`. `data-menu="herdr"` is an id used by
  `ui/menus.ts:113` and `tests/unit/ui/menus.test.ts:139`; `MenuName "herdr"`
  (`shortcuts.ts:21`, `:198`, `:219`, `:491`) is used by
  `tests/unit/shortcuts.test.ts:209`. Keep both ids unchanged.
- Change the visible text to `Cowbell`.
- The Keyboard Shortcuts modal prints the `MenuName` as its heading
  (`ui/shortcutsModal.ts:29`). Show `Cowbell` for `"herdr"` there
  (`heading.textContent = menu === "herdr" ? "Cowbell" : menu`) and update
  `tests/unit/ui/shortcutsModal.test.ts:27`. (Open question 4.)
- The orange dot (`#herdr-menu-dot`) shows for an update or integration updates
  (`appMenuBar.ts:317`). Set its `title` and `aria-label` there:
  `"herdr update available"` when `updateAvailable`, else `"Integration updates
  available"`. Add `role="img"` in `index.html`.

### S13 [P3] Reduced motion and focus rings

- There is no pulse animation: `rg "@keyframes|animation" gui/src/style.css` finds
  nothing. The motion is three transitions: `style.css:308` (sash hover), `:1443`
  (copy toast), `:1854` (bell flash). Add at the end of `style.css`:

  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
  ```

- `style.css:66` `:focus { outline: none; }` removes the ring from every element not
  in the list at `:70-80`. Unringed today: `.btn` (the confirm popover's Cancel,
  focused on open), `.agent-row`, `.agent-popover__pin`, `.find-bar__input`,
  `.run-btn`, `.run-device`, `.connection-banner__start-btn`, wizard buttons, and
  (after S10) `.tab-plus`/`.tab-overflow`. Replace `:66` with:

  ```css
  :focus:not(:focus-visible) { outline: none; }
  :focus-visible { outline: 1px solid var(--focusBorder); outline-offset: -1px; }
  ```

  Keep the explicit list at `:70-80` (harmless). `style.css:694`
  (`#terminal { outline: none; }`) stays: the canvas is `tabindex="-1"` and keyboard
  focus lives on the hidden `#keyboard-capture` (opacity 0, `:720-731`).

## 5. Not in scope

- Run toolbar Stop state.
- Brand illustration.
- A UI zoom setting.
- Workspace colour versus agent state redesign: it needs a design decision from the
  user.
- A fix for the blue square (S4 is investigation only).
- Restyling server-drawn borders or titles inside herdr.

## 6. Acceptance

### 6.1 Offline, after each slice

```
cd gui
npx tsc --noEmit
npx vitest run
```

For S1 and S2 (Rust changes), also:

```
cd gui
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

Or run all of it with `npm run check`. Unit tests to add, per slice: S1 and S2
`tests/unit/paneChrome/geometry.test.ts` plus the Rust `pane_layout` tests; S3
`tests/unit/paneClose.test.ts`; S5 the `agentPopover.test.ts` cases; S7
`tests/unit/themes/contrast.test.ts`; S8 `tests/unit/ui/paneActionItems.test.ts`; S9
`sidebar.test.ts`; S11 `tabs.test.ts`; S12 `shortcutsModal.test.ts`.

### 6.2 Live visual check (the user, on a fresh portable build, §7)

1. Split a tab right, then down. The focused pane has a 2px blue ring on top of its
   border line (no second, parallel grey line). The other panes look slightly dimmer.
2. Click another pane. The ring moves at once. Change the font size (View ▸ Zoom In)
   and move the window to a monitor with another scale. The ring stays on the lines.
3. Each pane title is readable. The focused header shows split right, split down and
   close. An unfocused header shows them only while the pointer is over that pane.
   Tooltips show Alt+Shift+=, Alt+Shift+-, Alt+Shift+W.
4. Drag the horizontal split line (away from the buttons). The panes resize.
5. Zoom a pane (Alt+Shift+Z). A "Zoomed" badge shows; click it; the pane unzooms.
6. Open the find bar (Ctrl+Shift+F). It sits below the header buttons.
7. Close a pane that runs a working agent (header ✕, Alt+Shift+W, and the right-click
   menu). A confirm names the agent, with Cancel focused. Close an idle shell pane: it
   closes at once.
8. Open the agent list from the status bar. It opens above the counts, is at most 60%
   of the window high, idle agents sit behind "N idle", and each row is one line with
   a workspace chip.
9. Switch to Tokyo Night. Tab labels and sidebar branch lines are readable. Switch
   back to Dark Modern.
10. Windows "Show animations" off: the copy toast appears without a fade.

## 7. Build: portable exe

The procedure is `gui/scripts/package.mjs` (`gui/package.json` scripts `package`,
`package:fast`).

```
cd gui
npm run package:fast     # test build, about 1 minute (no fat LTO, 16 codegen units)
npm run package          # full build, about 30 minutes (fat LTO, CARGO_BUILD_JOBS=2); publish only this one
```

- The script first runs `scripts/gen-notices.mjs`, then `tauri build --no-bundle`
  with `CARGO_TARGET_DIR=gui/target-agent`.
- Cargo output: `gui/target-agent/release/herdr-gui.exe`.
- The script copies it to `gui/target-agent/release/portable/Cowbell.exe`. When that
  file is running (EBUSY/EPERM), it writes
  `gui/target-agent/release/portable/Cowbell-<yyyyMMdd-HHmm>.exe` instead (for
  example `Cowbell-20260929-1541.exe`) and prints that path. The script never kills a
  running Cowbell.
- Run it in the foreground (or in a Herdr pane). Do not start the exe from a tool
  call; the user starts it.

Freshness check (a build that exits 0 is not proof):

```
Get-ChildItem gui\target-agent\release\herdr-gui.exe, gui\target-agent\release\portable\*.exe |
  Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime, Length
```

The newest portable exe and `herdr-gui.exe` must carry a timestamp from this build
(minutes old), and the path must match the `package: portable exe at …` or `wrote the
new build to …` line in the build output.

## 8. Risks / how this could be wrong

- **Ring placement.** `ringBox` assumes the server line sits in the middle of a border
  cell next to `inner_rect`. If the live check shows a blue ring next to a grey line,
  the assumption is wrong for that border config; log `pane_layout` and fix
  `ringBox`, not the CSS.
- **Title read-back.** `borderTitle` assumes the title run ends at a box-drawing cell.
  A label that itself contains U+2500-U+257F would be cut short. The DOM label would
  then not cover the full server title.
- **IPC per frame.** `pane_layout` runs once per surface frame, like today's close
  button call. If the perf HUD shows paint time rising with 10+ panes, gate the call
  on a layout revision.
- **Zoom flag.** `RawTab.zoomed` comes from `ClientShellTab.zoomed`. If the server's
  snapshot JSON omits it, the badge never shows (safe failure).
- **Zoomed mirror.** The spec assumes a zoomed tab puts one pane in the mirror. If it
  keeps all panes, the dim would cover hidden panes; check in live step 5.
- **Popups.** The chrome hides while `has_popup()` is true. If herdr draws popups
  without the frame's `popup` field, the chrome could draw over them.
- **Contrast.** The S7 numbers use the built-in token values. Imported themes and
  opacity-reduced text (`.ws-close` at 0.7, disabled items at 0.5) are not covered.
- **Blue square.** S4 ranks hypotheses from code reading only. None is confirmed.

## 9. Open questions for the user (defaults apply if no answer)

1. Focus ring colour: `--focusBorder` (blue in Dark Modern, but peach in the herdr
   theme and purple in Dracula), or always the status blue `--herdr-status-working`?
   **Default: `--focusBorder`.**
2. An unsplit, unzoomed pane has no border row. Show a floating pill with split
   buttons there too? **Default: no header on that pane.**
3. Close Pane glyph: `chrome-close` (thin ✕), `trash`, or `close-all`?
   **Default: `chrome-close`.**
4. Rename the Keyboard Shortcuts group heading "herdr" to "Cowbell" together with the
   menu label? **Default: yes.**

## S4 findings

Investigation only, 2026-09-30. No code changed for S4. I read the code; I did not run the app, so nothing below is confirmed by a live observation.

**Read.** `appTerminalMouse.ts` (`onPointerDown` `:246-248`, `onPointerMove`/`dragged` `:418`, `onPointerUp` `:444-470`, `clearSelectionOnInput` `:582-585`), `mouse/selectionOverlay.ts` (`render` `:49-55`, `clear`), `style.css` (`.terminal-selection-row`, `.terminal-find-match-row`, `.terminal-copymode-row`, `.terminal-copymode-cursor`), `copyNotice.ts` (`showCopiedNotice`), `themes/dark-modern.ts` (`terminal.selectionBackground` `#264f78`, `menu.selectionBackground` `#0078d4`), and every `overlay.clear()` / `clearSelectionOnInput()` caller.

**Ruled in (code path is real).** Hypothesis 1 holds mechanically. Each `.terminal-selection-row` is an absolutely positioned div at fixed CSS px inside `#terminal-wrap`, filled `#264f78` at `opacity: 0.5`. The only clear points are: the next `pointerdown` (`:246-247`), input to a pane (`appTerminalInput.ts:25`, `:33`, `:56` via `clearSelectionOnInput`), and a click without drag (`:460`). The only callers of `overlay.clear()` are those. Nothing clears the overlay on output scroll, `content_revision` change, tab switch, workspace switch or resize. So a 1-3 cell selection can stay on screen at a fixed spot while the text underneath moves. This is a possible mechanism, not proof that it is the reported square.

**Ruled out or made less likely by reading.**

- Hypothesis 5 (terminal cursor): Dark Modern cursor is `#cccccc`, not blue.
- Hypothesis 4 (copy-mode cursor, find match): both need an active mode, and neither uses the blue selection colour by default. Copy-mode rows use `--terminal-selectionBackground`, so they look the same as hypothesis 1 while copy mode is active.
- The new pane chrome from S1/S2 is not a candidate: the ring is a 2px border with no fill, the dim layer has the terminal background colour at 0.15, and the header buttons are transparent. The old `.pane-close-button` (removed in S2) was transparent, 20px.
- Hypothesis 3 (the "Copied" toast) fits less well: it carries the word "Copied" and hides after 2 s.

**Could not rule in or out.** Hypothesis 2 (the agent's own TUI paints a blue cell block). Only the live evidence in the spec's "Evidence needed" list separates it from hypothesis 1: `document.elementsFromPoint(x, y)` at the square's centre, the `.terminal-selection-row` count, whether one click removes it, and whether it scrolls with the text. I cannot run those here.

**Next step.** Run the spec's repro recipe and evidence checks on a build. Write a fix spec only after a `.terminal-selection-row` hit confirms hypothesis 1. Falsifier: if `elementsFromPoint` shows only `#terminal` and the square scrolls with the text, the cause is canvas content from the server, and no GUI fix applies.
