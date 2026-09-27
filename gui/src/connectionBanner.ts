// Pure decision table for the disconnected banner (Phase 1.6 addendum
// §11.3): "engine Missing/Broken + server unreachable -> 'herdr engine is
// not installed' + [Open Setup]; engine found + server down -> [Start
// herdr] (existing)." Kept pure (no DOM, no Tauri `invoke`) so the table is
// unit-testable on its own -- `main.ts` is the controller that fetches the
// engine status and paints this decision.

export type EngineKind = "missing" | "found" | "broken";

export type BannerAction = "open_setup" | "start_herdr";

export interface BannerDecision {
  visible: boolean;
  message: string;
  /** `null` while the banner is hidden, or while the engine status is
   * still being fetched (spec: never crash, never show a wrong button
   * while unknown). */
  action: BannerAction | null;
}

const CHECKING_MESSAGE = "Checking herdr status…";
const ENGINE_MISSING_MESSAGE = "herdr engine is not installed";

/** `engineKind` is `null` while the async `engine_status` probe this
 * decision depends on hasn't resolved yet for the current disconnect
 * (main.ts's own concern) -- shown as a neutral "checking" message with no
 * button, rather than guessing. */
export function decideConnectionBanner(
  connectionStatus: string,
  engineKind: EngineKind | null,
  socketPath: string,
): BannerDecision {
  if (connectionStatus !== "unavailable" && connectionStatus !== "disconnected") {
    return { visible: false, message: "", action: null };
  }
  if (engineKind === null) {
    return { visible: true, message: CHECKING_MESSAGE, action: null };
  }
  if (engineKind !== "found") {
    return { visible: true, message: ENGINE_MISSING_MESSAGE, action: "open_setup" };
  }
  return {
    visible: true,
    message: `herdr server not reachable at ${socketPath} — retrying`,
    action: "start_herdr",
  };
}
