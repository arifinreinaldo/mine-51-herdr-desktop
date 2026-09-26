// Frontend bootstrap (spec §6): "The first paint shows the chrome
// immediately (sidebar skeleton + usage bar), then the terminal when the
// first surface arrives. Call report_ready after two
// requestAnimationFrames following the first chrome paint."
//
// This file is intentionally thin: wiring the sidebar/canvas/usage bar to
// live backend data needs `decoder.ts`, `grid.ts`, `agents.ts`, `usage.ts`,
// `colors.ts`, and `input/keymap.ts`, all of which are stubbed elsewhere in
// this scaffold and are the implementer's job.

import { invoke } from "@tauri-apps/api/core";

function paintChromeSkeleton(): void {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.textContent = "";
  }
  const usageBar = document.getElementById("usage-bar");
  if (usageBar) {
    usageBar.textContent = "Claude usage: waiting for a Claude Code session";
  }
}

function reportReadyAfterTwoFrames(startedAt: number): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ms = performance.now() - startedAt;
      void invoke("report_ready", { ms });
    });
  });
}

function main(): void {
  const startedAt = performance.now();
  paintChromeSkeleton();
  reportReadyAfterTwoFrames(startedAt);
}

main();
