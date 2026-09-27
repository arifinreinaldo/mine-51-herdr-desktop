// Status bar: agent counts, connection indicator, usage item, and their
// popovers (spec phase1.5 §7 "Status bar and popovers").

import { focusKeyboardCapture } from "../keyboard/focusCapture";
import type { HighlightCard } from "../notifications/doneDetector";
import { formatAge } from "../notifications/statusAge";
import {
  formatAsOfLabel,
  formatFiveHourPopoverRow,
  formatFiveHourStatusBarLabel,
  formatWeeklyPopoverRow,
  usageColor,
  worstActivePct,
  type UsageState,
} from "../usage";
import { notifyOverlayClosed, openOverlay } from "./overlay";
import { createStatusDot, statusWord, type AgentStatus } from "./statusDot";

export type { AgentStatus };

export interface AgentCounts {
  working: number;
  blocked: number;
  done: number;
  idle: number;
}

const COUNT_ORDER: readonly (keyof AgentCounts)[] = ["working", "blocked", "done", "idle"];

/** UX pass 1 spec §4 "Honest disconnected state": while the connection is
 * not `connected`, the agent counts show the time of the last snapshot
 * instead of updating live. */
export interface DisconnectedCountsState {
  /** `""` when no snapshot has ever been received yet (finding #8): the dim
   * style still applies, but no "as of" suffix renders -- there is no
   * snapshot time to show one for. */
  asOfLabel: string;
}

/** "as of HH:MM" (local time) -- the counts' suffix while disconnected
 * (spec §4). `epochMs` is `Date.now()`-style. */
export function formatAsOfClock(epochMs: number): string {
  const date = new Date(epochMs);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `as of ${hh}:${mm}`;
}

export function renderAgentCounts(
  el: HTMLElement,
  counts: AgentCounts,
  onClickGroup: (status: keyof AgentCounts) => void,
  disconnected: DisconnectedCountsState | null = null,
): void {
  el.textContent = "";
  el.classList.toggle("is-disconnected", disconnected !== null);
  for (const key of COUNT_ORDER) {
    const n = counts[key];
    if (n <= 0) continue;
    const item = document.createElement("div");
    item.className = "status-item";
    item.tabIndex = 0;
    item.appendChild(createStatusDot(key));
    const label = document.createElement("span");
    label.textContent = `${n} ${key}`;
    item.appendChild(label);
    item.addEventListener("click", () => onClickGroup(key));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClickGroup(key);
      }
    });
    el.appendChild(item);
  }
  // Finding #8: an empty `asOfLabel` (no snapshot received yet) renders the
  // dim style above with no suffix at all, rather than a misleading "as of"
  // with nothing to date it by.
  if (disconnected && disconnected.asOfLabel) {
    const asOf = document.createElement("span");
    asOf.className = "status-agent-counts__as-of";
    asOf.textContent = disconnected.asOfLabel;
    el.appendChild(asOf);
  }
}

export function renderConnectionStatus(el: HTMLElement, status: string): void {
  el.textContent = "";
  const icon = document.createElement("i");
  icon.className = "codicon codicon-plug";
  el.appendChild(icon);
  const label = document.createElement("span");
  label.textContent = status === "connected" ? "herdr connected" : "reconnecting…";
  el.appendChild(label);
}

// ---------------------------------------------------------------------------
// Usage item + popover
// ---------------------------------------------------------------------------

function renderUsageMeterInto(container: HTMLElement, className: string, pct: number): void {
  const meter = document.createElement("span");
  meter.className = className;
  const fill = document.createElement("i");
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  meter.appendChild(fill);
  container.appendChild(meter);
}

interface UsagePopoverCallbacks {
  /** The pointer entered the popover itself -- cancel whatever close timer
   * the caller (the status item, finding #10) may have scheduled. */
  onEnter?: () => void;
  /** The pointer left the popover -- the caller re-schedules its own
   * close, so leaving the item OR the popover behaves identically. */
  onLeave?: () => void;
  /** Fired from inside `dispose()` itself, so it runs no matter *how* the
   * popover closed (its own hover-out, an outside click, Esc, or another
   * overlay opening and calling `closeActiveOverlay()`) -- finding #10
   * "reset closer after dispose". */
  onClose?: () => void;
}

function openUsagePopover(
  overlayRoot: HTMLElement,
  anchor: HTMLElement,
  usage: UsageState,
  now: number,
  callbacks: UsagePopoverCallbacks = {},
): () => void {
  const rootRect = overlayRoot.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover-layer usage-popover";
  popover.style.right = `${rootRect.right - anchorRect.right}px`;
  popover.style.bottom = `${rootRect.bottom - anchorRect.top}px`;

  const header = document.createElement("div");
  header.className = "usage-popover__header";
  const title = document.createElement("b");
  title.textContent = "Claude usage";
  header.appendChild(title);
  const asOf = formatAsOfLabel(usage.captured_at, now);
  if (asOf) {
    const asOfEl = document.createElement("span");
    asOfEl.textContent = asOf;
    header.appendChild(asOfEl);
  }
  popover.appendChild(header);

  const fiveHourRow = formatFiveHourPopoverRow(usage.five_hour, now);
  if (fiveHourRow) {
    const row = document.createElement("div");
    row.className = "usage-popover__row";
    const label = document.createElement("span");
    label.textContent = "5-hour";
    const value = document.createElement("span");
    value.textContent = fiveHourRow;
    row.append(label, value);
    popover.appendChild(row);
    renderUsageMeterInto(popover, "usage-popover__bar", usage.five_hour?.used_pct ?? 0);
  }

  const weeklyRow = formatWeeklyPopoverRow(usage.seven_day, now);
  if (weeklyRow) {
    const row = document.createElement("div");
    row.className = "usage-popover__row";
    const label = document.createElement("span");
    label.textContent = "Weekly";
    const value = document.createElement("span");
    value.textContent = weeklyRow;
    row.append(label, value);
    popover.appendChild(row);
    renderUsageMeterInto(popover, "usage-popover__bar", usage.seven_day?.used_pct ?? 0);
  }

  overlayRoot.appendChild(popover);

  popover.addEventListener("mouseenter", () => callbacks.onEnter?.());
  popover.addEventListener("mouseleave", () => callbacks.onLeave?.());

  function dispose(): void {
    popover.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture(); // finding #3: popover close returns focus to the terminal
    callbacks.onClose?.();
  }
  openOverlay(dispose);
  return dispose;
}

interface UsageItemState {
  usage: UsageState;
  now: number;
  closePopover: (() => void) | null;
  openTimer: number | undefined;
  closeTimer: number | undefined;
}

/** `renderUsageStatusItem` re-renders the same persistent `#status-usage`
 * element on every usage tick (spec §7, ~every 30s) and every `usage`
 * event; wiring a fresh set of listeners each time (the pre-fix behavior)
 * both leaked listeners and left each call's own `closePopover` variable
 * stale forever after the first close, since nothing reset it -- exactly
 * the "works only once" bug (finding #10). Interactions are wired exactly
 * once per element, keyed by it, and read the latest `usage`/`now` off this
 * mutable state instead. */
const usageItemState = new WeakMap<HTMLElement, UsageItemState>();

function scheduleUsageClose(state: UsageItemState): void {
  if (state.closeTimer !== undefined) return;
  state.closeTimer = window.setTimeout(() => {
    state.closeTimer = undefined;
    state.closePopover?.();
  }, 150);
}

function cancelUsageClose(state: UsageItemState): void {
  if (state.closeTimer !== undefined) {
    window.clearTimeout(state.closeTimer);
    state.closeTimer = undefined;
  }
}

function wireUsageItemInteractions(el: HTMLElement, overlayRoot: HTMLElement, state: UsageItemState): void {
  const open = () => {
    if (state.closePopover) return;
    cancelUsageClose(state);
    state.closePopover = openUsagePopover(overlayRoot, el, state.usage, state.now, {
      onEnter: () => cancelUsageClose(state),
      onLeave: () => scheduleUsageClose(state),
      onClose: () => {
        state.closePopover = null;
      },
    });
  };
  el.addEventListener("mouseenter", () => {
    cancelUsageClose(state);
    if (state.openTimer !== undefined) return;
    state.openTimer = window.setTimeout(() => {
      state.openTimer = undefined;
      open();
    }, 0);
  });
  el.addEventListener("mouseleave", () => {
    if (state.openTimer !== undefined) {
      window.clearTimeout(state.openTimer);
      state.openTimer = undefined;
    }
    // Finding #10: close 150ms after the pointer leaves the *item*, same as
    // leaving the popover -- cancelled if it lands on the popover instead
    // (that path calls `onEnter` above via the popover's own listener).
    if (state.closePopover) scheduleUsageClose(state);
  });
  // Finding #10 "keyboard focus opens/blur closes".
  el.addEventListener("focus", open);
  el.addEventListener("blur", () => state.closePopover?.());
  el.addEventListener("click", () => {
    if (state.closePopover) {
      state.closePopover();
    } else {
      open();
    }
  });
}

export function renderUsageStatusItem(
  el: HTMLElement,
  overlayRoot: HTMLElement,
  usage: UsageState,
  now: number,
): void {
  el.textContent = "";
  el.classList.remove("is-warning", "is-danger");

  if (usage.status === "missing") {
    const label = document.createElement("span");
    label.textContent = "Claude usage: waiting";
    el.appendChild(label);
    return;
  }
  if (usage.status === "invalid") {
    const label = document.createElement("span");
    label.textContent = "Claude usage: unreadable file";
    el.appendChild(label);
    return;
  }

  const icon = document.createElement("i");
  icon.className = "codicon codicon-pulse";
  el.appendChild(icon);

  if (usage.five_hour && usage.five_hour.resets_at < now) {
    el.append("5h — reset");
  } else {
    el.append("5h");
    renderUsageMeterInto(el, "usage-meter", usage.five_hour?.used_pct ?? 0);
    const label = formatFiveHourStatusBarLabel(usage.five_hour, now);
    if (label) el.append(label);
  }

  const worst = worstActivePct(usage, now);
  const color = usageColor(worst);
  if (color === "warning") el.classList.add("is-warning");
  if (color === "danger") el.classList.add("is-danger");

  // Finding #10: wire the hover/focus/click interactions exactly once per
  // element (a `WeakMap` keyed by `el`), not on every re-render -- this
  // element is re-rendered on every usage tick (~30s) and every `usage`
  // event, and re-wiring each time both leaked listeners and left each
  // render's own `closePopover` stale forever after the first close.
  const existing = usageItemState.get(el);
  if (existing) {
    existing.usage = usage;
    existing.now = now;
  } else {
    const state: UsageItemState = { usage, now, closePopover: null, openTimer: undefined, closeTimer: undefined };
    usageItemState.set(el, state);
    wireUsageItemInteractions(el, overlayRoot, state);
  }
}

// ---------------------------------------------------------------------------
// Agent popover
// ---------------------------------------------------------------------------

export interface AgentPopoverRow {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  workspace_label: string;
  tab_label: string;
  agent_status: AgentStatus;
  /** `display_agent`, falling back to `name`, never the raw pane id (spec
   * §7 "Never show raw pane ids"). */
  agentName: string;
  /** `title`, falling back to `terminal_title_stripped`, then absent. */
  title: string | null;
  colorHex: string | undefined;
}

export interface AgentPopoverCallbacks {
  onFocusRow(row: AgentPopoverRow): void;
  onToggleSort(): void;
  /** A highlight card's hover state changed (finding #11 "hover pauses the
   * 8s auto-hide"): the caller feeds this into
   * `HighlightCardStack.prune()`'s `pausedPaneIds`. */
  onHighlightHoverChange?(paneId: string, hovering: boolean): void;
  /** The header's pin toggle was clicked (UX pass 1 spec §3). The caller
   * owns the persisted `agentListPinned` setting; this popover only reads
   * `options.pinned` back to decide its own auto-hide/outside-click
   * behaviour. */
  onTogglePin?(): void;
  /** Fired from inside `dispose()` itself, so it runs no matter how the
   * popover closed (finding #11 "closer reset so Ctrl+Shift+A always
   * toggles" -- the same stale-closer bug as finding #10's usage popover). */
  onClose?(): void;
  /** Only used while `options.pinned` -- forwarded to `openOverlay`'s
   * `onSupersededReopen` (finding #5): reopens the pinned list once
   * whatever bumped it (a menu, a hover popover, a confirm) itself finishes
   * closing, instead of leaving the pinned list gone for good. */
  onSupersededReopen?(): void;
}

/** UX pass 1 spec §2 "Agent list rows (popover), line 2": `<agent> ·
 * <status word> <age>[ · <title>]`, e.g. "claude · blocked 12m · Review
 * migration plan". `ageLabel` of `""` (age not known yet) omits the
 * trailing age, never showing "blocked " with a dangling space. */
export function formatAgentRowLine2(
  agentName: string,
  status: AgentStatus,
  ageLabel: string,
  title: string | null,
): string {
  const statusPart = ageLabel ? `${statusWord(status)} ${ageLabel}` : statusWord(status);
  const parts = [agentName, statusPart];
  if (title) parts.push(title);
  return parts.join(" · ");
}

function buildAgentRowEl(row: AgentPopoverRow, ageLabel: string, callbacks: AgentPopoverCallbacks): HTMLElement {
  const el = document.createElement("div");
  el.className = "agent-row";
  el.tabIndex = 0;
  el.dataset.paneId = row.pane_id;

  el.appendChild(createStatusDot(row.agent_status));

  const line1 = document.createElement("span");
  if (row.colorHex) {
    const chip = document.createElement("span");
    chip.className = "agent-row__chip";
    chip.style.background = row.colorHex;
    line1.appendChild(chip);
  }
  const strong = document.createElement("b");
  strong.textContent = `${row.workspace_label} · ${row.tab_label}`;
  line1.appendChild(strong);
  el.appendChild(line1);
  el.appendChild(document.createElement("span"));

  const line2 = document.createElement("span");
  line2.className = "agent-row__title";
  line2.textContent = formatAgentRowLine2(row.agentName, row.agent_status, ageLabel, row.title);
  el.appendChild(line2);

  el.addEventListener("click", () => callbacks.onFocusRow(row));
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      callbacks.onFocusRow(row);
    }
  });
  return el;
}

/** UX pass 1 spec §3 "Blocked and done first": the popover's rows (below
 * the highlight cards) grouped as Needs You (blocked, oldest first), Done
 * (newest first), Working, then Idle. `unknown`-status rows fall in with
 * Idle -- herdr's agent-count model has no separate bucket for them
 * either. Within Needs You/Done, rows are re-ordered by age; Working/Idle
 * keep whatever relative order the caller's `rows` were already in
 * (priority or server order). */
export interface GroupedAgentRows {
  needsYou: AgentPopoverRow[];
  done: AgentPopoverRow[];
  working: AgentPopoverRow[];
  idle: AgentPopoverRow[];
}

export function groupAgentRows(
  rows: readonly AgentPopoverRow[],
  ageMsFor: (paneId: string) => number | undefined,
): GroupedAgentRows {
  const needsYou = rows.filter((r) => r.agent_status === "blocked");
  const done = rows.filter((r) => r.agent_status === "done");
  const working = rows.filter((r) => r.agent_status === "working");
  const idle = rows.filter((r) => r.agent_status === "idle" || r.agent_status === "unknown");
  // Oldest (largest age) first.
  needsYou.sort((a, b) => (ageMsFor(b.pane_id) ?? 0) - (ageMsFor(a.pane_id) ?? 0));
  // Newest (smallest age) first.
  done.sort((a, b) => (ageMsFor(a.pane_id) ?? 0) - (ageMsFor(b.pane_id) ?? 0));
  return { needsYou, done, working, idle };
}

const AGENT_GROUP_SECTIONS: readonly [label: string, key: keyof GroupedAgentRows][] = [
  ["Needs you", "needsYou"],
  ["Done", "done"],
  ["Working", "working"],
  ["Idle", "idle"],
];

export interface OpenAgentPopoverOptions {
  sortMode: "priority" | "server_order";
  highlightCards: readonly HighlightCard[];
  highlightRowFor: (paneId: string) => AgentPopoverRow | undefined;
  /** UX pass 1 spec §3 "Pinnable agent list": while pinned, the popover
   * doesn't auto-hide and doesn't close on an outside click (both enforced
   * by the caller/this module respectively). Defaults to `false`. */
  pinned?: boolean;
  /** Feeds each row's age label (spec §2) and the Needs You/Done ordering
   * (spec §3). Defaults to "always unknown" so callers that don't care
   * about ages (most tests) don't need to supply one. */
  ageMsFor?: (paneId: string) => number | undefined;
}

/** Finding #2 "refresh": keyed by the popover's own root element, so
 * `refreshOpenAgentPopover` can rebuild an already-open popover's content
 * in place without holding onto the closure `openAgentPopover` returns
 * (the caller only ever kept the `dispose` function, per `AgentCounts`'s
 * existing `agentPopoverCloser: (() => void) | null` shape -- adding a
 * second return value would have meant threading a new type through every
 * call site instead of just this one lookup). */
const agentPopoverRefreshers = new WeakMap<
  HTMLElement,
  (rows: readonly AgentPopoverRow[], options: OpenAgentPopoverOptions, callbacks: AgentPopoverCallbacks) => void
>();

/** Opens the agent popover, anchored bottom-left (spec §7 "Agent popover").
 * `highlightCards` render first, as "DONE · just now" cards; the remaining
 * `rows` (already sorted by the caller) render below them, skipping any
 * pane already shown as a highlight card. */
export function openAgentPopover(
  overlayRoot: HTMLElement,
  rows: readonly AgentPopoverRow[],
  options: OpenAgentPopoverOptions,
  callbacks: AgentPopoverCallbacks,
): () => void {
  const popover = document.createElement("div");
  popover.className = "popover-layer agent-popover";
  popover.style.left = "6px";
  popover.style.bottom = "30px";

  // UX pass 1 spec §3: pin state is only ever set by the initial `open`
  // call and by a full close+reopen (the caller's own `onTogglePin`
  // handler) -- never by `refresh` (finding #2's periodic/snapshot content
  // refresh never changes pinning) -- so it's fixed for this popover
  // instance's whole lifetime.
  const pinned = options.pinned ?? false;
  // Finding #11 "arrow keys + Enter navigate rows": rebuilt by
  // `renderContent` below (including on a `refresh`) -- a `let`, not a
  // `const`, so `onKeydown`'s closure (defined once, after the first
  // render) always sees the *current* rows, not the ones open the popover
  // built.
  let rowEls: HTMLElement[] = [];

  function renderContent(
    currentRows: readonly AgentPopoverRow[],
    currentOptions: OpenAgentPopoverOptions,
    currentCallbacks: AgentPopoverCallbacks,
  ): void {
    const ageMsFor = currentOptions.ageMsFor ?? (() => undefined);
    popover.textContent = "";
    const nextRowEls: HTMLElement[] = [];

    const header = document.createElement("div");
    header.className = "agent-popover__header";
    header.append("AGENTS");
    const sort = document.createElement("span");
    sort.className = "agent-popover__sort";
    sort.textContent = currentOptions.sortMode === "priority" ? "priority ▾" : "server order ▾";
    sort.addEventListener("click", currentCallbacks.onToggleSort);
    header.appendChild(sort);
    // UX pass 1 spec §3 "Pinnable agent list".
    const pinBtn = document.createElement("button");
    pinBtn.className = "agent-popover__pin";
    pinBtn.setAttribute("aria-label", pinned ? "Unpin agent list" : "Pin agent list");
    pinBtn.setAttribute("aria-pressed", String(pinned));
    const pinIcon = document.createElement("i");
    pinIcon.className = `codicon codicon-${pinned ? "pinned" : "pin"}`;
    pinBtn.appendChild(pinIcon);
    pinBtn.addEventListener("click", () => currentCallbacks.onTogglePin?.());
    header.appendChild(pinBtn);
    popover.appendChild(header);

    const highlightedPaneIds = new Set(currentOptions.highlightCards.map((c) => c.transition.pane_id));
    for (const card of currentOptions.highlightCards) {
      const row = currentOptions.highlightRowFor(card.transition.pane_id);
      if (!row) continue;
      const el = buildAgentRowEl(row, formatAge(ageMsFor(row.pane_id)), currentCallbacks);
      el.classList.add("is-highlight");
      const doneLabel = document.createElement("span");
      doneLabel.className = "agent-row__done-label";
      doneLabel.textContent = "DONE · just now";
      el.appendChild(doneLabel);
      const jumpHint = document.createElement("span");
      jumpHint.className = "agent-row__meta";
      jumpHint.textContent = "Enter ↵ jump";
      el.appendChild(jumpHint);
      // Finding #11 "hover pauses the 8s auto-hide": only highlight cards
      // are subject to it (`HighlightCardStack.prune`'s `pausedPaneIds` is
      // keyed by the *transition*'s pane id), so only they report hover.
      el.addEventListener("mouseenter", () => currentCallbacks.onHighlightHoverChange?.(row.pane_id, true));
      el.addEventListener("mouseleave", () => currentCallbacks.onHighlightHoverChange?.(row.pane_id, false));
      popover.appendChild(el);
      nextRowEls.push(el);
    }

    // UX pass 1 spec §3 "Blocked and done first": grouped sections below the
    // highlight cards, each with a small header naming its count. Empty
    // groups render no header.
    const remaining = currentRows.filter((row) => !highlightedPaneIds.has(row.pane_id));
    const grouped = groupAgentRows(remaining, ageMsFor);
    for (const [label, key] of AGENT_GROUP_SECTIONS) {
      const groupRows = grouped[key];
      if (groupRows.length === 0) continue;
      const groupHeader = document.createElement("div");
      groupHeader.className = "agent-popover__group-header";
      groupHeader.textContent = `${label} (${groupRows.length})`;
      popover.appendChild(groupHeader);
      for (const row of groupRows) {
        const el = buildAgentRowEl(row, formatAge(ageMsFor(row.pane_id)), currentCallbacks);
        popover.appendChild(el);
        nextRowEls.push(el);
      }
    }

    if (currentOptions.highlightCards.length > 0) {
      const footer = document.createElement("div");
      footer.className = "agent-popover__footer";
      footer.textContent = "auto-hides in 8s · hover to keep open";
      popover.appendChild(footer);
    }

    rowEls = nextRowEls;
  }

  renderContent(rows, options, callbacks);

  // Finding #11 "arrow keys + Enter navigate rows": Enter was already
  // per-row (`buildAgentRowEl`); Up/Down move focus between rows here.
  const onKeydown = (event: KeyboardEvent) => {
    const focusInsidePopover = popover.contains(document.activeElement);
    if (event.key === "Escape") {
      // Finding #3: a pinned list must never swallow an Esc typed outside
      // it (e.g. in the terminal) -- only close on Esc here when focus is
      // actually inside the popover, or it isn't pinned at all. (The
      // central router's own Esc-closes-overlay rule is separately gated
      // for the same reason, via `openOverlay`'s `escapableFromOutside`
      // below.)
      if (!focusInsidePopover && pinned) return;
      event.preventDefault();
      dispose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    // Finding #3: Arrow keys navigate rows only when focus is already
    // inside the popover -- otherwise they must not intercept arrow keys
    // typed elsewhere (e.g. the sidebar, or a future terminal binding).
    if (!focusInsidePopover) return;
    const activeIndex = rowEls.indexOf(document.activeElement as HTMLElement);
    if (activeIndex === -1 && rowEls.length > 0) {
      event.preventDefault();
      rowEls[0].focus();
      return;
    }
    if (rowEls.length === 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    rowEls[(activeIndex + delta + rowEls.length) % rowEls.length].focus();
  };
  document.addEventListener("keydown", onKeydown, true);
  const onOutsideClick = (event: MouseEvent) => {
    // UX pass 1 spec §3: pinned, this popover "does not close on an
    // outside click." Esc (above) and the pin toggle/status-bar counts
    // (the caller's own click handler) still close it.
    if (pinned) return;
    if (!popover.contains(event.target as Node)) dispose();
  };
  window.setTimeout(() => document.addEventListener("mousedown", onOutsideClick), 0);

  overlayRoot.appendChild(popover);
  agentPopoverRefreshers.set(popover, renderContent);

  function dispose(): void {
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick);
    popover.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture(); // finding #3: popover close returns focus to the terminal
    callbacks.onClose?.();
  }
  // Finding #3 (escapableFromOutside)/#5 (onSupersededReopen): only a
  // *pinned* popover opts out of the central router's outside-Esc close and
  // asks to be reopened once whatever superseded it later closes.
  openOverlay(dispose, {
    escapableFromOutside: !pinned,
    onSupersededReopen: pinned ? callbacks.onSupersededReopen : undefined,
  });
  return dispose;
}

/** Finding #2 "refresh": rebuilds the given open popover's rows/groupings
 * in place (fresh ages, snapshot-driven changes) *without* disposing or
 * reopening it -- unlike a fresh `openAgentPopover` call, this never calls
 * `focusKeyboardCapture()` and is a no-op while the user's keyboard focus
 * is already inside the popover (a row, the sort/pin control), so a
 * background refresh (the 30s tick, or a new snapshot) can never steal
 * focus mid-navigation. Returns `true` when it actually found an open
 * popover to refresh. */
export function refreshOpenAgentPopover(
  overlayRoot: HTMLElement,
  rows: readonly AgentPopoverRow[],
  options: OpenAgentPopoverOptions,
  callbacks: AgentPopoverCallbacks,
): boolean {
  const popover = overlayRoot.querySelector<HTMLElement>(".agent-popover");
  if (!popover) return false;
  if (popover.contains(document.activeElement)) return false;
  const refresh = agentPopoverRefreshers.get(popover);
  if (!refresh) return false;
  refresh(rows, options, callbacks);
  return true;
}
