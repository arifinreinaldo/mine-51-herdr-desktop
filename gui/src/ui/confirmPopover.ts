// Inline confirmation popover (spec phase1.5 §5 "Close workspace"): "never
// window.confirm." Anchored to a trigger element, closed by Esc, an
// outside click, Cancel, or Confirm.
//
// UX pass 1 spec §1 "[P0] Safe close-workspace confirm": Cancel -- never the
// destructive button -- has focus on open, so a bare Enter cancels; the
// destructive action needs an explicit click or a focus move (Tab) first.
// The body can also list which agents the destructive action actually
// stops ("Name what stops").

import { focusKeyboardCapture } from "../keyboard/focusCapture";
import { notifyOverlayClosed, openOverlay } from "./overlay";
import { createStatusDot, type AgentStatus } from "./statusDot";

/** One "Name what stops" line: `<status dot> <tab label> · <agent name>`
 * (spec §1). */
export interface ConfirmPopoverAgentLine {
  status: AgentStatus;
  tabLabel: string;
  agentName: string;
}

export interface ConfirmPopoverAgentList {
  /** Already truncated by the caller (spec §1: "at most 5 lines"). */
  lines: readonly ConfirmPopoverAgentLine[];
  /** How many more agents beyond `lines` exist; 0 renders no "and N more"
   * line. */
  overflow: number;
}

export interface ConfirmPopoverOptions {
  /** e.g. "Close " then a bold name then "?" -- built as DOM nodes, never
   * raw HTML, so a workspace/tab label can never inject markup. */
  titlePrefix: string;
  titleName: string;
  titleSuffix?: string;
  detail: string;
  /** "Name what stops" (spec §1): omitted for confirms that aren't about
   * closing a workspace. */
  agentLines?: ConfirmPopoverAgentList;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

/** Anchors a `.confirm-popover` to the right of `anchor` (spec §5: "opens
 * an inline confirmation popover ... anchored right of the row"). */
export function openConfirmPopover(
  root: HTMLElement,
  anchor: HTMLElement,
  options: ConfirmPopoverOptions,
): () => void {
  const popover = document.createElement("div");
  popover.className = "confirm-popover";
  const anchorRect = anchor.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  popover.style.left = `${anchorRect.right - rootRect.left + 8}px`;
  popover.style.top = `${anchorRect.top - rootRect.top}px`;

  const title = document.createElement("div");
  title.className = "confirm-popover__title";
  title.append(options.titlePrefix, document.createElement("b"));
  (title.lastChild as HTMLElement).textContent = options.titleName;
  if (options.titleSuffix) title.append(options.titleSuffix);
  popover.appendChild(title);

  const detail = document.createElement("div");
  detail.className = "confirm-popover__detail";
  detail.textContent = options.detail;
  popover.appendChild(detail);

  if (options.agentLines && options.agentLines.lines.length > 0) {
    const list = document.createElement("div");
    list.className = "confirm-popover__agent-list";
    for (const line of options.agentLines.lines) {
      const row = document.createElement("div");
      row.className = "confirm-popover__agent-line";
      row.appendChild(createStatusDot(line.status));
      const text = document.createElement("span");
      text.textContent = `${line.tabLabel} · ${line.agentName}`;
      row.appendChild(text);
      list.appendChild(row);
    }
    if (options.agentLines.overflow > 0) {
      const more = document.createElement("div");
      more.className = "confirm-popover__agent-more";
      more.textContent = `and ${options.agentLines.overflow} more`;
      list.appendChild(more);
    }
    popover.appendChild(list);
  }

  const actions = document.createElement("div");
  actions.className = "confirm-popover__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = options.cancelLabel ?? "Cancel";
  cancelBtn.addEventListener("click", () => {
    dispose();
    options.onCancel?.();
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn--danger";
  confirmBtn.textContent = options.confirmLabel;
  confirmBtn.addEventListener("click", () => {
    dispose();
    options.onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  popover.appendChild(actions);

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
      options.onCancel?.();
      return;
    }
    if (event.key === "Enter") {
      // Finding (UX pass 1 §1): Enter always resolves via whichever button
      // currently has focus. Cancel is focused on open, so a bare Enter
      // cancels; the destructive button only fires this way after an
      // explicit focus move onto it (Tab). Handled entirely here --
      // `preventDefault()` suppresses any native button-activation click
      // -- rather than relying on the browser to synthesize one, so this
      // is the one and only source of Enter-driven confirm/cancel.
      // The focus check must happen *before* `dispose()`: `dispose()`
      // itself moves focus (`focusKeyboardCapture()`), which would
      // otherwise always make `document.activeElement` read back as
      // neither button by the time it's checked.
      event.preventDefault();
      const shouldConfirm = document.activeElement === confirmBtn;
      dispose();
      if (shouldConfirm) {
        options.onConfirm();
      } else {
        options.onCancel?.();
      }
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  const onOutsideClick = (event: MouseEvent) => {
    if (!popover.contains(event.target as Node) && event.target !== anchor) {
      dispose();
      options.onCancel?.();
    }
  };
  window.setTimeout(() => document.addEventListener("mousedown", onOutsideClick), 0);

  function dispose(): void {
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick);
    popover.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture(); // finding #3: confirm-popover close returns focus to the terminal
  }

  // MAJOR P0 (UX pass 1 review): `openOverlay` must run *before* this
  // popover is even appended/focused, not after. `openOverlay` closes
  // whatever overlay was already open (e.g. a pinned agent popover), and
  // that overlay's own `dispose()` calls `focusKeyboardCapture()` --
  // stealing focus right back off Cancel if it ran second, which left a
  // bare Enter reaching the terminal instead of cancelling this confirm.
  openOverlay(dispose);

  root.appendChild(popover);
  // Finding (UX pass 1 §1 "[P0]"): Cancel gets focus by default, never the
  // destructive button -- a bare Enter on open therefore cancels. This
  // must run *after* `openOverlay` above, for the same reason.
  cancelBtn.focus();

  return dispose;
}
