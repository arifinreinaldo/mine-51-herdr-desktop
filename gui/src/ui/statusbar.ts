// Status bar: agent counts, connection indicator, usage item, and their
// popovers (spec phase1.5 §7 "Status bar and popovers").

import { focusKeyboardCapture } from "../keyboard/focusCapture";
import type { HighlightCard } from "../notifications/doneDetector";
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

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentCounts {
  working: number;
  blocked: number;
  done: number;
  idle: number;
}

const COUNT_ORDER: readonly (keyof AgentCounts)[] = ["working", "blocked", "done", "idle"];

export function renderAgentCounts(
  el: HTMLElement,
  counts: AgentCounts,
  onClickGroup: (status: keyof AgentCounts) => void,
): void {
  el.textContent = "";
  for (const key of COUNT_ORDER) {
    const n = counts[key];
    if (n <= 0) continue;
    const item = document.createElement("div");
    item.className = "status-item";
    item.tabIndex = 0;
    const dot = document.createElement("span");
    dot.className = `status-dot status-dot--${key}`;
    item.appendChild(dot);
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
  /** Fired from inside `dispose()` itself, so it runs no matter how the
   * popover closed (finding #11 "closer reset so Ctrl+Shift+A always
   * toggles" -- the same stale-closer bug as finding #10's usage popover). */
  onClose?(): void;
}

function buildAgentRowEl(row: AgentPopoverRow, callbacks: AgentPopoverCallbacks): HTMLElement {
  const el = document.createElement("div");
  el.className = "agent-row";
  el.tabIndex = 0;
  el.dataset.paneId = row.pane_id;

  const dot = document.createElement("span");
  dot.className = `status-dot status-dot--${row.agent_status}`;
  el.appendChild(dot);

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
  line2.textContent = row.title ? `${row.agentName} — ${row.title}` : row.agentName;
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

export interface OpenAgentPopoverOptions {
  sortMode: "priority" | "server_order";
  highlightCards: readonly HighlightCard[];
  highlightRowFor: (paneId: string) => AgentPopoverRow | undefined;
}

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

  const header = document.createElement("div");
  header.className = "agent-popover__header";
  header.append("AGENTS");
  const sort = document.createElement("span");
  sort.className = "agent-popover__sort";
  sort.textContent = options.sortMode === "priority" ? "priority ▾" : "server order ▾";
  sort.addEventListener("click", callbacks.onToggleSort);
  header.appendChild(sort);
  popover.appendChild(header);

  const rowEls: HTMLElement[] = [];
  const highlightedPaneIds = new Set(options.highlightCards.map((c) => c.transition.pane_id));
  for (const card of options.highlightCards) {
    const row = options.highlightRowFor(card.transition.pane_id);
    if (!row) continue;
    const el = buildAgentRowEl(row, callbacks);
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
    el.addEventListener("mouseenter", () => callbacks.onHighlightHoverChange?.(row.pane_id, true));
    el.addEventListener("mouseleave", () => callbacks.onHighlightHoverChange?.(row.pane_id, false));
    popover.appendChild(el);
    rowEls.push(el);
  }

  for (const row of rows) {
    if (highlightedPaneIds.has(row.pane_id)) continue;
    const el = buildAgentRowEl(row, callbacks);
    popover.appendChild(el);
    rowEls.push(el);
  }

  if (options.highlightCards.length > 0) {
    const footer = document.createElement("div");
    footer.className = "agent-popover__footer";
    footer.textContent = "auto-hides in 8s · hover to keep open";
    popover.appendChild(footer);
  }

  // Finding #11 "arrow keys + Enter navigate rows": Enter was already
  // per-row (`buildAgentRowEl`); Up/Down move focus between rows here.
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
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
    if (!popover.contains(event.target as Node)) dispose();
  };
  window.setTimeout(() => document.addEventListener("mousedown", onOutsideClick), 0);

  overlayRoot.appendChild(popover);

  function dispose(): void {
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick);
    popover.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture(); // finding #3: popover close returns focus to the terminal
    callbacks.onClose?.();
  }
  openOverlay(dispose);
  return dispose;
}
