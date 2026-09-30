// Pane chrome: a DOM overlay drawn over the one canvas that paints every pane.
// It draws the focus ring, a dim layer on unfocused panes, and a header strip
// (title plus actions) on each pane's top border row. It reads geometry only
// (`pane_layout`); it never changes the canvas size or the `resize` IPC.
// Pure maths lives in `geometry.ts`.

import { api, invokeSafe } from "../appApi";
import { terminalWrapEl } from "../appDom";
import { appState } from "../appState";
import { focusKeyboardCapture } from "../keyboard/focusCapture";
import { paneOverlayOrigin } from "../mouse/overlayGeometry";
import { requestClosePane } from "../paneClose";
import { shortcutDisplay } from "../shortcuts";
import { borderTitle, headerMode, ringBox, type LayoutPane } from "./geometry";

const BTN = 24;
const BTN_GAP = 2;
const ACTIONS_PAD = 4;
const ZOOMED_BADGE_WIDTH = 72; // estimate: text width is not measured
const TITLE_GAP = 8;

let container: HTMLDivElement | null = null;
let inFlight = false;
let pending = false;
let lastKey = "";
/** Wrap-relative CSS boxes of the last drawn layout, for the hover test. */
let paneBoxes: { paneId: string; left: number; top: number; right: number; bottom: number }[] = [];
let pointer: { x: number; y: number } | null = null;

function tooltip(label: string, id: string): string {
  const key = shortcutDisplay(id);
  return key ? `${label} (${key})` : label;
}

function applyHover(): void {
  if (!container) return;
  let hoveredId: string | null = null;
  if (pointer) {
    const p = pointer;
    hoveredId = paneBoxes.find((b) => p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom)?.paneId ?? null;
  }
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(".pane-header"))) {
    el.classList.toggle("is-hovered", el.dataset.paneId === hoveredId);
  }
}

function ensureContainer(): HTMLDivElement {
  if (container) return container;
  container = document.createElement("div");
  container.className = "pane-chrome";
  terminalWrapEl.appendChild(container);
  terminalWrapEl.addEventListener("pointermove", (event) => {
    const wrap = terminalWrapEl.getBoundingClientRect();
    pointer = { x: event.clientX - wrap.left, y: event.clientY - wrap.top };
    applyHover();
  });
  terminalWrapEl.addEventListener("pointerleave", () => {
    pointer = null;
    applyHover();
  });
  return container;
}

function clear(): void {
  if (container) container.replaceChildren();
  terminalWrapEl.style.setProperty("--pane-chrome-top", "0px");
  paneBoxes = [];
  lastKey = "";
}

/** Re-reads `pane_layout` and redraws the ring, the dim layers and the
 * headers. Coalesced: at most one IPC in flight, one trailing call. */
export function refreshPaneChrome(): void {
  if (inFlight) {
    pending = true;
    return;
  }
  inFlight = true;
  void invokeSafe<LayoutPane[]>("pane_layout").then((layout) => {
    try {
      render(layout ?? []);
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        refreshPaneChrome();
      }
    }
  });
}

function makeButton(action: string, icon: string, label: string, extra = ""): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `pane-header__btn${extra}`;
  btn.dataset.action = action;
  btn.tabIndex = -1;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const i = document.createElement("i");
  i.className = `codicon codicon-${icon}`;
  btn.appendChild(i);
  return btn;
}

function onHeaderClick(action: string, paneId: string, el: HTMLElement): void {
  // Refocus first: an idle close opens no popover and removes this button
  // while it has focus. A confirm popover takes focus itself afterwards.
  focusKeyboardCapture();
  if (action === "splitRight") void api("pane.split", { direction: "right", target_pane_id: paneId, focus: true });
  else if (action === "splitDown") void api("pane.split", { direction: "down", target_pane_id: paneId, focus: true });
  else if (action === "close") requestClosePane(paneId, el);
  else if (action === "unzoom") void api("pane.zoom", { pane_id: paneId });
}

function render(layout: LayoutPane[]): void {
  const renderer = appState.renderer;
  if (!renderer || layout.length === 0) {
    clear();
    return;
  }
  const zoomed = appState.snapshot?.tabs.find((t) => t.focused)?.zoomed === true;
  const grid = appState.grid;
  const origin = paneOverlayOrigin({ x: 0, y: 0, width: 0, height: 0 }, renderer);
  const { originLeft, originTop, cellWidthCss: cw, cellHeightCss: ch } = origin;

  const items = layout.map((pane) => ({
    pane,
    mode: headerMode(pane, zoomed),
    title: borderTitle(grid, pane),
  }));
  const key = JSON.stringify([layout, cw, ch, originLeft, originTop, zoomed, items.map((i) => i.title)]);
  if (key === lastKey) return;
  lastKey = key;

  const root = ensureContainer();
  const nodes: HTMLElement[] = [];
  paneBoxes = [];
  const x = (c: number) => originLeft + c * cw;
  const y = (c: number) => originTop + c * ch;
  const multi = layout.length >= 2;
  let touchesTop = false;

  for (const { pane, mode, title } of items) {
    const { rect } = pane;
    paneBoxes.push({
      paneId: pane.pane_id,
      left: x(rect.x),
      top: y(rect.y),
      right: x(rect.x + rect.width),
      bottom: y(rect.y + rect.height),
    });
    const box = ringBox(pane, layout);
    if (multi) {
      if (pane.focused) {
        const ring = document.createElement("div");
        ring.className = "pane-ring";
        ring.style.left = `${x(box.left) - 1}px`;
        ring.style.top = `${y(box.top) - 1}px`;
        ring.style.width = `${(box.right - box.left) * cw + 2}px`;
        ring.style.height = `${(box.bottom - box.top) * ch + 2}px`;
        nodes.push(ring);
      } else {
        const dim = document.createElement("div");
        dim.className = "pane-dim";
        dim.style.left = `${x(rect.x)}px`;
        dim.style.top = `${y(rect.y)}px`;
        dim.style.width = `${rect.width * cw}px`;
        dim.style.height = `${rect.height * ch}px`;
        nodes.push(dim);
      }
    }
    if (mode === "none") continue;
    const showZoomed = zoomed && pane.focused;
    const actionsWidth = 3 * BTN + 2 * BTN_GAP + ACTIONS_PAD + (showZoomed ? ZOOMED_BADGE_WIDTH + BTN_GAP : 0);
    const headerLeft = x(box.left);
    const headerWidth = x(box.right) - headerLeft;
    if (headerWidth < 3 * BTN + 8) continue;

    const header = document.createElement("div");
    header.className = `pane-header${pane.focused ? " is-focused" : ""}`;
    header.dataset.paneId = pane.pane_id;
    header.style.left = `${headerLeft}px`;
    header.style.width = `${headerWidth}px`;
    header.style.height = `${BTN}px`;
    const content = pane.inner_rect;
    const centre = mode === "strip" ? y(rect.y + 0.5) : y(content.y) + 2 + BTN / 2;
    header.style.top = `${centre - BTN / 2}px`;
    if (mode === "strip" ? rect.y === 0 : content.y === 0) touchesTop = true;

    if (mode === "strip" && title) {
      const titleEl = document.createElement("span");
      titleEl.className = "pane-header__title";
      const left = x(title.startCol) - headerLeft;
      const maxWidth = Math.max(0, headerWidth - left - actionsWidth - TITLE_GAP);
      titleEl.textContent = title.text;
      titleEl.style.left = `${left}px`;
      titleEl.style.top = `${(BTN - ch) / 2}px`;
      titleEl.style.height = `${ch}px`;
      titleEl.style.lineHeight = `${ch}px`;
      titleEl.style.minWidth = `${Math.min(title.cells * cw, maxWidth)}px`;
      titleEl.style.maxWidth = `${maxWidth}px`;
      header.appendChild(titleEl);
    }

    const actions = document.createElement("div");
    actions.className = "pane-header__actions";
    if (showZoomed) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "pane-header__zoomed";
      badge.dataset.action = "unzoom";
      badge.tabIndex = -1;
      badge.textContent = "Zoomed";
      const label = tooltip("Restore from zoom", "pane.toggleZoom");
      badge.title = label;
      badge.setAttribute("aria-label", label);
      actions.appendChild(badge);
    }
    actions.appendChild(makeButton("splitRight", "split-horizontal", tooltip("Split Right", "pane.splitRight")));
    actions.appendChild(makeButton("splitDown", "split-vertical", tooltip("Split Down", "pane.splitDown")));
    actions.appendChild(
      makeButton("close", "chrome-close", tooltip("Close Pane", "pane.close"), " pane-header__btn--close"),
    );
    // Keep the terminal's own pointer handling (focus, selection) off these clicks.
    actions.addEventListener("pointerdown", (event) => event.stopPropagation());
    actions.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!target?.dataset.action) return;
      event.stopPropagation();
      onHeaderClick(target.dataset.action, pane.pane_id, target);
    });
    header.appendChild(actions);
    nodes.push(header);
  }

  root.replaceChildren(...nodes);
  const findBarTop = touchesTop ? Math.max(BTN, ch) + 4 : 0;
  terminalWrapEl.style.setProperty("--pane-chrome-top", `${findBarTop}px`);
  applyHover();
}
