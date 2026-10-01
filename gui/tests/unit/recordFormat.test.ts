import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_SECONDS,
  formatBytes,
  formatElapsed,
  recordButtonView,
  recordFailureText,
  type RecState,
} from "../../src/android/recordFormat";

describe("formatElapsed", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [1000, "0:01"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [75 * 60_000 + 3_000, "75:03"],
    [-5, "0:00"],
    [Number.NaN, "0:00"],
  ])("%s ms gives %s", (ms, want) => {
    expect(formatElapsed(ms)).toBe(want);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [Math.round(12.4 * 1024 * 1024), "12.4 MB"],
    [Math.round(1.5 * 1024 ** 3), "1.5 GB"],
  ])("%s bytes gives %s", (bytes, want) => {
    expect(formatBytes(bytes)).toBe(want);
  });
});

describe("recordButtonView", () => {
  const states: RecState[] = ["idle", "starting", "recording", "stopping", "result", "error"];

  it("matches the table for every state", () => {
    expect(recordButtonView("idle")).toEqual({
      pressed: false,
      busy: false,
      recording: false,
      icon: "circle-filled",
      title: "Record",
    });
    expect(recordButtonView("starting")).toEqual({
      pressed: true,
      busy: true,
      recording: false,
      icon: "loading",
      title: "Starting… (click to cancel)",
    });
    expect(recordButtonView("recording")).toEqual({
      pressed: true,
      busy: false,
      recording: true,
      icon: "circle-filled",
      title: "Stop recording",
    });
    expect(recordButtonView("stopping")).toEqual({
      pressed: true,
      busy: true,
      recording: false,
      icon: "loading",
      title: "Saving the recording…",
    });
  });

  it("shows the countdown digit while starting, then the spinner", () => {
    expect(recordButtonView("starting", 3)).toEqual({
      pressed: true,
      busy: false,
      recording: false,
      icon: "",
      digit: 3,
      title: "Recording starts in 3… (click to cancel)",
    });
    expect(recordButtonView("starting", 1).digit).toBe(1);
    // Countdown over but the recorder is not ready yet: the existing spinner.
    expect(recordButtonView("starting", 0)).toEqual(recordButtonView("starting"));
    expect(recordButtonView("starting", 0).digit).toBeUndefined();
  });

  it("ignores the count outside the starting state", () => {
    for (const state of states.filter((s) => s !== "starting")) {
      expect(recordButtonView(state, 3)).toEqual(recordButtonView(state));
    }
  });

  it("counts down from three seconds", () => {
    expect(COUNTDOWN_SECONDS).toBe(3);
  });

  it("shows result and error like idle", () => {
    expect(recordButtonView("result")).toEqual(recordButtonView("idle"));
    expect(recordButtonView("error")).toEqual(recordButtonView("idle"));
  });

  it("gives each of the four distinct looks its own title", () => {
    const titles = states.map((s) => recordButtonView(s).title);
    expect(new Set(titles).size).toBe(4);
  });
});

describe("recordFailureText", () => {
  it("uses the message of the payload, trimmed", () => {
    expect(recordFailureText({ code: "record_empty", message: "  Disk full " })).toBe("Disk full");
  });

  it.each([[null], [undefined], ["text"], [42], [{}], [{ message: "" }], [{ message: "   " }], [{ message: 5 }]])(
    "falls back to a generic line for %j",
    (payload) => {
      expect(recordFailureText(payload)).toBe("The recording stopped and no file was saved");
    },
  );
});
