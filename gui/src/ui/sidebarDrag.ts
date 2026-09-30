// Drag a sidebar workspace row up or down to reorder the workspaces. Pointer
// events, not HTML5 drag and drop: Tauri's file-drop handler turns HTML5 drag
// events off on Windows (see the same note in `tabs.ts`). Pointer capture
// keeps the events coming while the cursor is anywhere in the window, so
// slot 0 (the first position) is reachable by moving above the first row.
//
// `renderSidebar` makes one controller per render and attaches it to every
// row. The drag holds a render-guard claim, so a snapshot that arrives
// mid-drag cannot rebuild the rows and drop the drag's own state.

import { caretSlotFromPos, dragDropInsertIndex } from "../workspace/tabMove";
import { beginRenderGuard } from "./renderGuard";

const DRAG_START_PX = 4;

interface DragState {
  row: HTMLElement;
  index: number;
  workspaceId: string;
  caretEl: HTMLElement;
  startY: number;
  /** The pointer has moved past `DRAG_START_PX`: the press is now a drag. */
  active: boolean;
  /** The caret slot the pointer is over (0..=row count). */
  slot: number;
}

export type AttachSidebarDrag = (row: HTMLElement, index: number, workspaceId: string) => void;

export function createSidebarDrag(
  listEl: HTMLElement,
  guardRegion: string,
  onMove: (workspaceId: string, insertIndex: number) => void,
): AttachSidebarDrag {
  let drag: DragState | null = null;
  let releaseGuard: (() => void) | null = null;
  /** The click that follows a drag's pointer release must not focus the workspace. */
  let suppressClick = false;

  return (row, index, workspaceId) => {
    row.addEventListener(
      "click",
      (event) => {
        if (!suppressClick) return;
        event.stopImmediatePropagation();
        event.preventDefault();
      },
      true,
    );

    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || drag) return;
      if ((event.target as HTMLElement).closest(".ws-close, input")) return;
      drag = { row, index, workspaceId, caretEl: document.createElement("div"), startY: event.clientY, active: false, slot: index };
      drag.caretEl.className = "ws-drop-caret";
      row.setPointerCapture?.(event.pointerId);
    });

    row.addEventListener("pointermove", (event) => {
      if (!drag || drag.row !== row) return;
      if (!drag.active) {
        if (Math.abs(event.clientY - drag.startY) < DRAG_START_PX) return;
        drag.active = true;
        row.classList.add("is-dragging");
        releaseGuard = beginRenderGuard(guardRegion);
      }
      const rows = Array.from(listEl.querySelectorAll<HTMLElement>(".ws"));
      const midpoints = rows.map((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      drag.slot = caretSlotFromPos(event.clientY, midpoints);
      listEl.insertBefore(drag.caretEl, rows[drag.slot] ?? null);
    });

    const endDrag = (commit: boolean) => {
      const ended = drag;
      if (!ended || ended.row !== row) return;
      drag = null;
      ended.caretEl.remove();
      row.classList.remove("is-dragging");
      if (ended.active) {
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
        // Dropping in place (before itself, or right after itself) moves nothing.
        if (commit && ended.slot !== ended.index && ended.slot !== ended.index + 1) {
          onMove(ended.workspaceId, dragDropInsertIndex(ended.slot));
        }
      }
      releaseGuard?.();
      releaseGuard = null;
    };
    row.addEventListener("pointerup", () => endDrag(true));
    row.addEventListener("pointercancel", () => endDrag(false));
  };
}
