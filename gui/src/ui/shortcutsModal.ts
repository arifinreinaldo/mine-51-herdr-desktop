// The "Keyboard Shortcuts" modal (Ctrl+Shift+/, herdr ▸ Keyboard Shortcuts,
// Help ▸ Keyboard Shortcuts -- one implementation, three entry points).
// Searchable and grouped by menu; the data comes entirely from
// `shortcuts.ts`'s `cheatSheetEntries`/`filterCheatSheetEntries`/
// `groupCheatSheetEntriesByMenu` (single source of truth). DOM wiring only
// -- see `shortcuts.ts` for the pure filtering/grouping logic itself.

import {
  cheatSheetEntries,
  filterCheatSheetEntries,
  groupCheatSheetEntriesByMenu,
} from "../shortcuts";
import { openModal } from "./modal";

function renderList(listEl: HTMLElement, query: string): void {
  listEl.textContent = "";
  const filtered = filterCheatSheetEntries(cheatSheetEntries(), query);
  const groups = groupCheatSheetEntriesByMenu(filtered);
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "shortcuts-modal-empty";
    empty.textContent = "No matching shortcuts.";
    listEl.appendChild(empty);
    return;
  }
  for (const [menu, entries] of groups) {
    const heading = document.createElement("h3");
    heading.className = "shortcuts-modal-group";
    heading.textContent = menu === "herdr" ? "Cowbell" : menu;
    listEl.appendChild(heading);
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "modal-shortcut-row";
      row.append(entry.label);
      const key = document.createElement("span");
      key.className = "key";
      key.textContent = entry.display;
      row.appendChild(key);
      listEl.appendChild(row);
    }
  }
}

/** Opens the modal and returns its disposer (`openModal`'s own return
 * value) -- callers that don't need to dismiss it programmatically can
 * ignore the return value, as every existing `on*` menu handler does. */
export function openKeyboardShortcutsModal(): () => void {
  return openModal("Keyboard Shortcuts", (body) => {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "shortcuts-modal-search";
    search.placeholder = "Filter shortcuts…";
    search.setAttribute("aria-label", "Filter shortcuts");
    body.appendChild(search);

    const list = document.createElement("div");
    list.className = "shortcuts-modal-list";
    body.appendChild(list);

    renderList(list, "");
    search.addEventListener("input", () => renderList(list, search.value));
    // Deferred: `openModal` hasn't appended `backdrop` to `document.body`
    // yet at the point `buildBody` runs, and an unattached element can't
    // take focus.
    window.setTimeout(() => search.focus(), 0);
  });
}
