# herdr GUI — UX pass 1 spec (from the Impeccable critique, 26/40)

Source: the critique snapshot in `.impeccable/critique/2026-09-27T06-17-31Z__gui-src-main-ts.md`
(P0, both P1s, and the P2). The visual language stays the same (Phase 1.5 tokens and
mockups). Nothing outside `gui/` changes.

## 1. [P0] Safe close-workspace confirm

- In `ui/confirmPopover.ts`, **focus Cancel by default**, never the destructive
  button. Enter on open therefore cancels. The destructive button keeps its red style.
- **Name what stops.** The confirm body lists the agents in that workspace that are
  running or blocked, one line each: `<status dot> <tab label> · <agent name>`, at
  most 5 lines, then "and N more".
- **Fix the count text** (`sidebar.ts:closeDetailText`). Handle the plural
  correctly: "1 agent", "2 agents". Say what happens: "Stops 2 working and 1
  blocked agent." With no agents, say "No agents running."
- herdr cannot detach a single workspace (detach is per client), so there is **no
  "Detach instead"** option. Do not invent one.

## 2. [P1] Agent state in words, not colour alone

- **Status dots get distinct shapes** as well as colours, in every place they
  appear (sidebar, tabs, agent list, status bar):
  - working: a filled circle;
  - blocked: a filled square or diamond;
  - done: a check or a filled circle with a ring;
  - idle: a hollow circle;
  - unknown: a dashed hollow circle.

  Every dot gets `role="img"` and `aria-label="<status>"`.
- **Agent list rows (popover), line 2:** `<agent> · <status word> <age>[ · <title>]`,
  for example "claude · blocked 12m · Review migration plan". The title comes from
  the existing `agentTaskTitle` helper. The status words are "working", "blocked",
  "done", "idle", and "unknown".
- **Age:** the time since that pane's status last changed. Track it client-side:
  record `Date.now()` when a pane's `agent_status` or `state_change_seq` changes
  between snapshots. Store it in a small pure module (`notifications/statusAge.ts`)
  with tests. The format is "now" (< 1 m), "Nm", "Nh", then "Nd". The age refreshes
  at least every 30 s while visible. After a reconnect or `boot_id` change, the
  unknown age shows nothing, not "0m".

## 3. [P1] A persistent "needs you" view

- **Pinnable agent list.** The agent popover header gets a pin toggle (codicon
  `pin` / `pinned`). While it is pinned, the popover does not auto-hide and does not
  close on an outside click. Esc, the pin toggle, or clicking the status-bar counts
  closes it. The pinned state persists in settings (`agentListPinned`), and the list
  reopens pinned at startup.
- **Blocked and done first:** the list is grouped as **Needs you** (blocked, oldest
  first), then **Done** (newest first), then **Working**, then **Idle**. Each group
  has a small header with its count. The done highlight cards stay as they are.
- **Sidebar line 2 for attention states only:** when a workspace has any blocked
  agent, line 2 shows `blocked · <age of the oldest blocked>` in
  `herdr.status.blocked` instead of the branch. When it has only done agents, line
  2 shows `done · <age>` in `herdr.status.done`. Otherwise it shows the branch as
  today. The branch is always available as the row tooltip.
- **Tab strip:** a blocked tab's label keeps its orange colour and gains the age
  suffix `· 12m` when the tab is not selected.

## 4. [P2] Honest disconnected state

- **When the connection is not `connected`:**
  - The status-bar agent counts and the terminal canvas are dimmed (opacity 0.5).
    The counts get the suffix "as of HH:MM" (the time of the last snapshot).
  - The sidebar and the tabs stay readable but are not interactive (no API calls).
    A click shows the notice "herdr is not connected".
- **Banner copy:**
  - "herdr isn't running — your agents may have stopped." plus [Start herdr], or
    "herdr engine is not installed." plus [Open Setup] (the existing logic).
  - The socket path moves into a "Details" disclosure inside the banner.
- **The banner button** uses `button.background` / `button.foreground` tokens and
  meets contrast ≥ 4.5:1 against the banner background.

## 5. Tests (Vitest; `npm run check` must stay green)

- **confirmPopover:** Cancel has focus on open; Enter cancels; the destructive
  action needs an explicit click or Tab + Enter.
- **closeDetailText:** plural and zero cases.
- **The agent list for the confirm:** the 5-line limit and "and N more".
- **statusAge:** it records on change, ignores unchanged snapshots, resets on
  reconnect, and formats "now", "Nm", "Nh", "Nd".
- **Popover grouping order and the pin behaviour:** outside clicks are ignored
  when pinned, and the pin persists.
- **The sidebar line 2 decision** (blocked, done, or the branch).
- **Dot shape and `aria-label`** per status.
- **Disconnected rendering:** the dim class, "as of" text, and the socket path inside
  Details.

## 6. Out of scope

Grouping the sidebar by status instead of by repo, a workspace-level detach,
blocked-reason text (herdr does not expose one), and any change to menus or
shortcuts.
