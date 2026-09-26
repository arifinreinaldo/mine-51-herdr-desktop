// E2E smoke spec (spec §9.9). Optional, not part of `npm run check`, not
// required for Phase 1 "done". Requires: scripts/test-session.bat running
// in another terminal, tauri-driver and msedgedriver installed (README.md),
// and a release build (`npm run tauri build`).
//
// Uses the global `browser` WebdriverIO injects at runtime (via
// @wdio/mocha-framework); no import needed for it.

import { execFileSync } from "node:child_process";

declare const browser: WebdriverIO.Browser;

describe("herdr GUI smoke", () => {
  it("shows the gui-test workspace in the sidebar", async () => {
    const sidebar = await browser.$("#sidebar");
    await sidebar.waitForExist({ timeout: 10_000 });
    const text = await sidebar.getText();
    expect(text.length).toBeGreaterThan(0);
  });

  it("paints a non-blank terminal canvas", async () => {
    const canvas = await browser.$("#terminal");
    await canvas.waitForExist({ timeout: 10_000 });
    const nonBlank = await browser.execute(() => {
      const el = document.getElementById("terminal") as HTMLCanvasElement | null;
      if (!el) return false;
      const ctx = el.getContext("2d");
      if (!ctx) return false;
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      return data.some((byte) => byte !== 0);
    });
    expect(nonBlank).toBe(true);
  });

  it("typing echo e2e-ok + Enter is visible via `herdr pane read`", async () => {
    const canvas = await browser.$("#terminal");
    await canvas.click();
    await browser.keys("echo e2e-ok");
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => {
        // The CLI *must* pass --session gui-test, or it reads the default
        // session (spec §9.9).
        const output = execFileSync("herdr", ["--session", "gui-test", "pane", "read"], {
          encoding: "utf-8",
        });
        return output.includes("e2e-ok");
      },
      { timeout: 10_000, timeoutMsg: "expected `herdr --session gui-test pane read` to contain e2e-ok" },
    );
  });
});
