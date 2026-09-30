// Flavor picker for the run toolbar: a modal with a search box over the
// flavor list. Type to filter, Up/Down to move, Enter or a click to pick.
// DOM only; the filtering is `filterFlavors` in `flutter/runState.ts`.

import { filterFlavors } from "../flutter/runState";
import { openModal } from "./modal";

export function openFlavorPicker(
  flavors: readonly string[],
  current: string | null,
  onPick: (flavor: string) => void,
): () => void {
  let dispose: () => void = () => {};
  dispose = openModal("Build flavor", (body) => {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "shortcuts-modal-search";
    search.placeholder = "Filter flavors…";
    search.setAttribute("aria-label", "Filter flavors");
    body.appendChild(search);

    const list = document.createElement("div");
    list.className = "flavor-list";
    body.appendChild(list);

    let matches: string[] = [];
    let index = 0;

    const pick = (flavor: string) => {
      dispose();
      onPick(flavor);
    };

    const render = () => {
      list.textContent = "";
      if (matches.length === 0) {
        const empty = document.createElement("p");
        empty.className = "shortcuts-modal-empty";
        empty.textContent = "No matching flavors.";
        list.appendChild(empty);
        return;
      }
      matches.forEach((flavor, i) => {
        const row = document.createElement("div");
        row.className = "flavor-row";
        row.classList.toggle("is-selected", i === index);
        row.textContent = flavor === current ? `${flavor}  ✓` : flavor;
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pick(flavor);
        });
        list.appendChild(row);
        if (i === index) row.scrollIntoView({ block: "nearest" });
      });
    };

    const refilter = () => {
      matches = filterFlavors(flavors, search.value);
      index = Math.max(0, current ? matches.indexOf(current) : 0);
      render();
    };

    search.addEventListener("input", refilter);
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (matches.length === 0) return;
        index = (index + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
        render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const chosen = matches[index];
        if (chosen) pick(chosen);
      }
    });

    refilter();
    // Deferred: the modal is not in the document yet (see shortcutsModal.ts).
    window.setTimeout(() => search.focus(), 0);
  });
  return dispose;
}
