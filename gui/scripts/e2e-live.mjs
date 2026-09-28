#!/usr/bin/env node
// Live end-to-end checks of the built GUI against the dedicated `gui-test`
// herdr session. Run: `npm run e2e:live [-- path\to\herdr-gui.exe]`.
//
// Why this and not tests/e2e (WebdriverIO): that setup needs tauri-driver,
// msedgedriver and extra npm packages. This drives the real WebView2 page over
// the Chrome DevTools Protocol with the `ws` package already installed.
// CDP input events are trusted input: they run the browser's default actions
// (focus on mousedown, and so on), so the focus bug of 2026-09-28 fails here.
//
// Preconditions:
// - The gui-test herdr server runs (`scripts\test-session.bat`).
// - No other Herdr Desktop window is open. The app is single-instance, so a
//   second launch only focuses the open window.
//
// The script creates its own tab in gui-test, closes it at the end, and
// restores the clipboard text that it overwrites.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertGuiTestSocketPath } from "./resolve-socket-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
const require = createRequire(path.join(guiRoot, "package.json"));
const WebSocket = require("ws");

const SESSION = "gui-test";
const CDP_PORT = 9334;
const exePath = process.argv[2] ?? path.join(guiRoot, "target-agent", "release", "herdr-gui.exe");
const env = { ...process.env, HERDR_SESSION: SESSION };
assertGuiTestSocketPath("e2e-live", env);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- herdr CLI

function herdr(...args) {
  const out = execFileSync("herdr", ["--session", SESSION, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.trim().startsWith("{") ? JSON.parse(out).result : out;
}

function layout(paneId) {
  return herdr("pane", "layout", "--pane", paneId).layout;
}

function visibleLines(paneId) {
  return String(herdr("pane", "read", paneId, "--source", "visible")).split(/\r?\n/);
}

async function waitFor(what, check, timeoutMs = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

// --------------------------------------------------------------------- CDP

async function connectCdp() {
  const targets = await waitFor("the GUI's DevTools endpoint", async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    return list.find((t) => t.type === "page" && t.url.includes("tauri.localhost")) ?? false;
  }, 20000);
  const ws = new WebSocket(targets.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`page threw: ${result.exceptionDetails.text}`);
    return result.result.value;
  };
  return { ws, send, evaluate };
}

// ------------------------------------------------------------ page helpers

/** CSS px of a tab-area cell centre. The canvas maps the tab area 1:1 from
 * its top-left corner; the cell size is the canvas width over the columns
 * (off by under one cell across the whole row, so aim at centres). */
async function cellToCss(cdp, area, col, row) {
  const box = await cdp.evaluate(`(() => {
    const r = document.getElementById("terminal").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const cellW = box.width / area.width;
  const cellH = box.height / area.height;
  return { x: box.left + (col + 0.5) * cellW, y: box.top + (row + 0.5) * cellH };
}

async function mouse(cdp, type, x, y, buttons) {
  await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
}

async function click(cdp, x, y) {
  await mouse(cdp, "mouseMoved", x, y, 0);
  await mouse(cdp, "mousePressed", x, y, 1);
  await mouse(cdp, "mouseReleased", x, y, 0);
  await sleep(300);
}

async function drag(cdp, from, to) {
  await mouse(cdp, "mouseMoved", from.x, from.y, 0);
  await mouse(cdp, "mousePressed", from.x, from.y, 1);
  for (let i = 1; i <= 8; i++) {
    await mouse(cdp, "mouseMoved", from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8, 1);
    await sleep(30);
  }
  await mouse(cdp, "mouseReleased", to.x, to.y, 0);
}

async function typeLine(cdp, text) {
  for (const ch of text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  }
  const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...enter });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
}

const activeElementId = (cdp) => cdp.evaluate("document.activeElement && document.activeElement.id");

function readClipboard() {
  // Another program can hold the Windows clipboard open for a moment
  // ("Requested Clipboard operation did not succeed"): retry, then give up.
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      if (attempt >= 5) throw err;
      execFileSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 300"]);
    }
  }
}

function writeClipboard(text) {
  execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value $input"], { input: text ?? "" });
}

// ------------------------------------------------------------------- tests

const results = [];
class Skip extends Error {}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (err) {
    if (err instanceof Skip) {
      results.push({ name, ok: true, skipped: true });
      console.log(`  skip  ${name}
        ${err.message}`);
      return;
    }
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Clicks a pane, types `echo <marker>` + Enter, and checks that the echoed
 * line (the marker alone) reaches that pane in herdr. */
async function typeIntoPane(cdp, paneId) {
  const lay = layout(paneId);
  const rect = lay.panes.find((p) => p.pane_id === paneId).rect;
  const at = await cellToCss(cdp, lay.area, rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
  await click(cdp, at.x, at.y);
  const focused = await activeElementId(cdp);
  assert(focused === "keyboard-capture", `after a click, keyboard focus is on "${focused}", not "keyboard-capture"`);
  const marker = `E2E${Date.now().toString(36).toUpperCase()}`;
  await typeLine(cdp, `echo ${marker}`);
  await waitFor(`"${marker}" echoed in ${paneId}`, () => visibleLines(paneId).some((line) => line.trim() === marker));
  return marker;
}

async function main() {
  try {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    throw new Error(`port ${CDP_PORT} is already in use; close the app that holds it`);
  } catch (err) {
    if (err.message.startsWith("port")) throw err;
  }
  herdr("workspace", "list"); // throws when the gui-test server is not running

  const app = spawn(exePath, [], {
    env: { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
    stdio: "ignore",
  });
  let appExited = false;
  app.on("exit", () => (appExited = true));

  let tabId;
  let savedClipboard;
  let cdp;
  try {
    cdp = await connectCdp().catch((err) => {
      if (appExited) throw new Error("the app exited at once: close any open Herdr Desktop window first");
      throw err;
    });
    await waitFor("the GUI to connect", () => cdp.evaluate(`document.body.innerText.includes("herdr connected")`), 20000);

    const workspace = herdr("workspace", "list").workspaces.find((w) => w.focused) ?? herdr("workspace", "list").workspaces[0];
    const created = herdr("tab", "create", "--workspace", workspace.workspace_id, "--label", "e2e", "--focus");
    tabId = JSON.stringify(created).match(/"tab_id":"([^"]+)"/)[1];
    const firstPane = await waitFor("the e2e tab's pane", () => {
      const panes = herdr("pane", "list", "--workspace", workspace.workspace_id).panes ?? [];
      return panes.find((p) => p.tab_id === tabId)?.pane_id;
    });
    await waitFor("the shell prompt", () => visibleLines(firstPane).some((line) => line.includes(">")), 15000);
    console.log(`e2e tab ${tabId}, pane ${firstPane}`);

    await test("click then type reaches the pane", () => typeIntoPane(cdp, firstPane));

    await test("the pane size follows the window, both ways", async () => {
      const before = layout(firstPane).area.width;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 0, mobile: false });
      const narrow = await waitFor("a narrower tab area", () => {
        const width = layout(firstPane).area.width;
        return width < before ? width : false;
      });
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await waitFor("the tab area to grow back", () => layout(firstPane).area.width > narrow);
    });

    let secondPane;
    await test("split right: both panes fit and take typing", async () => {
      herdr("pane", "split", firstPane, "--direction", "right", "--focus");
      secondPane = await waitFor("the new pane", () => layout(firstPane).panes.find((p) => p.pane_id !== firstPane)?.pane_id);
      const lay = layout(firstPane);
      const canvasCols = await cdp.evaluate(`document.getElementById("terminal").getBoundingClientRect().width`);
      assert(lay.panes.every((p) => p.rect.x + p.rect.width <= lay.area.width), "a pane lies outside the tab area");
      assert(canvasCols > 0, "the terminal canvas has no width");
      await typeIntoPane(cdp, secondPane);
      await typeIntoPane(cdp, firstPane);
    });

    await test("drag-select copies to the clipboard and shows Copied", async () => {
      try {
        savedClipboard = readClipboard();
      } catch {
        // Some apps (Teams, for one) put clipboard data that PowerShell
        // cannot read as text. It could not be restored, so do not overwrite it.
        throw new Skip("the clipboard holds data from another app that cannot be saved; copy some plain text and re-run");
      }
      const marker = await typeIntoPane(cdp, firstPane);
      const lay = layout(firstPane);
      const rect = lay.panes.find((p) => p.pane_id === firstPane).rect;
      const row = visibleLines(firstPane).findIndex((line) => line.trim() === marker);
      assert(row >= 0, "the echoed marker is not on screen");
      // The inner area starts one cell in from the pane's border.
      const from = await cellToCss(cdp, lay.area, rect.x + 1, rect.y + 1 + row);
      const to = await cellToCss(cdp, lay.area, rect.x + rect.width - 2, rect.y + 1 + row);
      await cdp.evaluate(`window.__e2eCopied = false; new MutationObserver(() => {
        if (document.getElementById("copy-notice").classList.contains("is-visible")) window.__e2eCopied = true;
      }).observe(document.getElementById("copy-notice"), { attributes: true })`);
      await drag(cdp, from, to);
      await waitFor("the marker on the clipboard", () => readClipboard().includes(marker));
      await waitFor("the Copied notice", () => cdp.evaluate("window.__e2eCopied"));
    });

    await test("the close button closes the focused split pane", async () => {
      assert(secondPane, "no split pane (the split test failed)");
      const box = await waitFor("a visible close button", () =>
        cdp.evaluate(`(() => {
          const b = document.querySelector(".pane-close-button");
          if (!b || b.hidden) return false;
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`),
      );
      const focusedBefore = layout(firstPane).focused_pane_id;
      const survivor = focusedBefore === firstPane ? secondPane : firstPane;
      await click(cdp, box.x, box.y);
      await waitFor(`${focusedBefore} closed, ${survivor} alone`, () => layout(survivor).panes.length === 1);
      assert((await activeElementId(cdp)) === "keyboard-capture", "keyboard focus did not return to the terminal");
    });
  } finally {
    if (savedClipboard !== undefined) writeClipboard(savedClipboard);
    if (tabId) {
      try {
        herdr("tab", "close", tabId);
      } catch {
        console.log(`note: could not close e2e tab ${tabId}`);
      }
    }
    cdp?.ws.close();
    app.kill();
  }

  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${results.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`e2e-live: ${err.message}`);
  process.exit(1);
});
