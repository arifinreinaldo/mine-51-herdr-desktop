// Tiny DOM helpers shared by the wizard's step renderers (kept out of
// `wizard.ts` so it doesn't grow into the god file the project's own
// convention warns against -- see `main.ts`'s header comment).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const b = el("button", className, label);
  b.addEventListener("click", onClick);
  return b;
}

export function appendLine(pre: HTMLElement, line: string): void {
  pre.appendChild(document.createTextNode(`${line}\n`));
  pre.scrollTop = pre.scrollHeight;
}

/** An inline "this will run: <command>" confirmation block (Phase 1.6
 * spec §4.2/§5: consent before any command runs or gets typed into a
 * pane). Inline rather than an anchored popover: it's simpler to nest
 * inside the wizard's own full-window overlay, with no z-index/positioning
 * coordination needed against `#overlay-root`. */
export function renderInlineConsent(
  container: HTMLElement,
  command: string,
  onConfirm: () => void,
  onCancel: () => void,
): void {
  const box = el("div", "wizard-consent");
  box.appendChild(el("p", "wizard-consent__label", "This will run:"));
  box.appendChild(el("pre", "wizard-consent__command", command));
  const actions = el("div", "wizard-consent__actions");
  const cancelBtn = button("Cancel", onCancel, "btn");
  // Finding #13 "double-click install": disable both buttons on the first
  // click, so a second click (or a slow-to-respond confirm handler) can
  // never fire `onConfirm` a second time.
  const runBtn = button(
    "Run",
    () => {
      if (runBtn.disabled) return;
      runBtn.disabled = true;
      cancelBtn.disabled = true;
      onConfirm();
    },
    "btn btn--primary",
  );
  actions.appendChild(cancelBtn);
  actions.appendChild(runBtn);
  box.appendChild(actions);
  container.appendChild(box);
}
