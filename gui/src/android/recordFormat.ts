// Pure helpers for the record button and result panel (`mirrorTools.ts`,
// `ui/recordPanel.ts`).

/** "m:ss". Minutes are not capped (75:03). Negative or NaN gives "0:00". Floors to whole seconds. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  return `${Math.floor(total / 60)}:${seconds}`;
}

/** 1024-based, one decimal from KB up: "0 B", "999 B", "1.0 KB", "12.4 MB", "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.floor(Number.isFinite(bytes) ? bytes : 0))} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The text of a `mirror-record-failed` payload. Anything unexpected gives a generic line. */
export function recordFailureText(payload: unknown): string {
  const message = payload && typeof payload === "object" ? (payload as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message.trim() : "The recording stopped and no file was saved";
}

export type RecState = "idle" | "starting" | "recording" | "stopping" | "result" | "error";

export interface RecordButtonView {
  pressed: boolean;
  busy: boolean;
  recording: boolean;
  icon: string;
  title: string;
  /** The countdown digit (3, 2, 1) shown in place of the icon. Absent outside the countdown. */
  digit?: number;
}

/** Seconds counted down before a recording starts. */
export const COUNTDOWN_SECONDS = 3;

/** The Record button for each state. `result` and `error` look like `idle`. `count` is the
 * countdown digit while `starting`; 0 once the countdown is over, when the spinner shows
 * until the recorder is ready. */
export function recordButtonView(state: RecState, count = 0): RecordButtonView {
  switch (state) {
    case "starting":
      if (count > 0) {
        return {
          pressed: true,
          busy: false,
          recording: false,
          icon: "",
          digit: count,
          title: `Recording starts in ${count}… (click to cancel)`,
        };
      }
      return { pressed: true, busy: true, recording: false, icon: "loading", title: "Starting… (click to cancel)" };
    case "recording":
      return { pressed: true, busy: false, recording: true, icon: "circle-filled", title: "Stop recording" };
    case "stopping":
      return { pressed: true, busy: true, recording: false, icon: "loading", title: "Saving the recording…" };
    default:
      return { pressed: false, busy: false, recording: false, icon: "circle-filled", title: "Record" };
  }
}
