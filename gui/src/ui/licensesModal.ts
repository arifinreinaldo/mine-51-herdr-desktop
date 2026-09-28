// Help ▸ Licenses… and the About dialog's own "Licenses…" button (spec D2):
// one modal, built with the existing modal pattern (`ui/shortcutsModal.ts`)
// -- a summary line, then the generated third-party notices file
// (`public/THIRD-PARTY-NOTICES.txt`, spec D1) in a scrollable `<pre>`. Esc
// closes it (the shared `openModal` behavior); theme tokens only.

import { openModal } from "./modal";

const SUMMARY = "Cowbell: FSL-1.1-ALv2 · herdr: Apache-2.0 · third-party notices below";

/** Opens the modal and returns its disposer, matching
 * `openKeyboardShortcutsModal`'s own return shape. */
export function openLicensesModal(): () => void {
  return openModal("Licenses", (body) => {
    const summary = document.createElement("p");
    summary.textContent = SUMMARY;
    body.appendChild(summary);

    const pre = document.createElement("pre");
    pre.className = "licenses-modal-notices";
    pre.textContent = "Loading third-party notices…";
    body.appendChild(pre);

    fetch("/THIRD-PARTY-NOTICES.txt")
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((text) => {
        pre.textContent = text;
      })
      .catch((err: unknown) => {
        pre.textContent = `Could not load third-party notices: ${err instanceof Error ? err.message : String(err)}`;
      });
  });
}
