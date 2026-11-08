// Asks before a blocked-but-consentable file (a web page) opens in its default app.

import { openModal } from "./modal";

/** `onOpen` runs only when the user presses Open. Focus starts on Cancel, so Enter never accepts by accident. */
export function openConsentDialog(fileName: string, onOpen: () => void): () => void {
  let cancel: HTMLButtonElement | null = null;
  const dispose = openModal("Open this file?", (body) => {
    const text = document.createElement("p");
    text.textContent = `Open ${fileName} in your default app? A web page can run scripts.`;
    const actions = document.createElement("div");
    actions.className = "confirm-popover__actions";
    cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dispose());
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn btn--primary";
    open.textContent = "Open";
    open.addEventListener("click", () => {
      dispose();
      onOpen();
    });
    actions.append(cancel, open);
    body.append(text, actions);
  });
  window.setTimeout(() => cancel?.focus(), 0);
  return dispose;
}
