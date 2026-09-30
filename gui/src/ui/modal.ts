// A simple centered modal (spec phase1.5 §4 "Keyboard Shortcuts" / "What's
// New" / "About"). Not a popover: it has a backdrop and blocks interaction
// with the rest of the app until dismissed (Esc or an outside click on the
// backdrop).

import { focusKeyboardCapture } from "../keyboard/focusCapture";
import { notifyOverlayClosed, openOverlay } from "./overlay";

export interface ModalOptions {
  /** Extra class on the `.modal` element. */
  className?: string;
  /** Runs once when the modal closes, before focus returns to the terminal. */
  onClose?: () => void;
}

let modalCount = 0;

export function openModal(
  title: string,
  buildBody: (body: HTMLElement) => void,
  options: ModalOptions = {},
): () => void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const modal = document.createElement("div");
  modal.className = options.className ? `modal ${options.className}` : "modal";
  const heading = document.createElement("h2");
  heading.id = `modal-title-${++modalCount}`;
  heading.textContent = title;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", heading.id);
  modal.appendChild(heading);

  const body = document.createElement("div");
  buildBody(body);
  modal.appendChild(body);

  backdrop.appendChild(modal);

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) dispose();
  });

  document.body.appendChild(backdrop);

  let closed = false;
  function dispose(): void {
    // Esc, the backdrop and a button can all call this; `onClose` runs once.
    if (!closed) {
      closed = true;
      options.onClose?.();
    }
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture(); // finding #3: modal close returns focus to the terminal
  }
  // Finding #4: modals must join the same overlay registry menus, popovers,
  // and confirm popovers already use, so the central keyboard router can
  // tell "some overlay is open" uniformly and route Esc to it instead of
  // the terminal, regardless of which of the four kinds it is.
  openOverlay(dispose);
  return dispose;
}
