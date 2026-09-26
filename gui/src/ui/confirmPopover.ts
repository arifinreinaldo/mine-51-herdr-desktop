// Inline confirmation popover (spec phase1.5 §5 "Close workspace"): "never
// window.confirm." Anchored to a trigger element, closed by Esc, an
// outside click, Cancel, or Confirm.

import { focusKeyboardCapture } from "../keyboard/focusCapture";
import { notifyOverlayClosed, openOverlay } from "./overlay";

export interface ConfirmPopoverOptions {
  /** e.g. "Close " then a bold name then "?" -- built as DOM nodes, never
   * raw HTML, so a workspace/tab label can never inject markup. */
  titlePrefix: string;
  titleName: string;
  titleSuffix?: string;
  detail: string;
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

  root.appendChild(popover);
  confirmBtn.focus();

  function dispose(): void {
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick);
    popover.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture(); // finding #3: confirm-popover close returns focus to the terminal
  }

  openOverlay(dispose);
  return dispose;
}
