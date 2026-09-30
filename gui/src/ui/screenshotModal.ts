// Screenshot preview modal (docs/screenshot-design.md): a thin wrapper that
// mounts the shared panel (`screenshotPanel.ts`) into `openModal`.

import { mountScreenshotPanel, type ScreenshotPanel } from "./screenshotPanel";
import { openModal } from "./modal";

export function openScreenshotModal(opts: { deviceName: string; deviceId: string }): () => void {
  let panel: ScreenshotPanel | undefined;
  const dispose = openModal(
    "Screenshot",
    (body) => {
      panel = mountScreenshotPanel(body, { ...opts, onClose: () => dispose() });
      // Deferred: the modal is not in the document yet (see flavorPicker.ts).
      window.setTimeout(() => panel?.focusInitial(), 0);
    },
    { className: "modal--shot", onClose: () => panel?.dispose() },
  );
  return dispose;
}
