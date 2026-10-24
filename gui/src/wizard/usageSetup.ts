// "Set up Claude usage" dialog: the wizard's usage step (consent, install,
// the shared-settings guidance) in a modal, opened from the status bar when
// the usage item has no data yet.

import { openModal } from "../ui/modal";
import { newWizardRunSummary } from "./logic";
import { renderUsageStep } from "./stepUsage";

export function openUsageSetup(): void {
  let disposeStep: () => void = () => {};
  let close: () => void = () => {};
  close = openModal(
    "Claude usage",
    (body) => {
      disposeStep = renderUsageStep(body, () => close(), () => close(), newWizardRunSummary());
    },
    { onClose: () => disposeStep() },
  );
}
