#!/usr/bin/env node
// Downloads the pinned herdr release zip (spec §2.1) into
// `src-tauri/resources/herdr/herdr-windows-x86_64.zip`, verifies its
// SHA-256 against `packaging/herdr-package.json`, and **fails the build**
// on a mismatch. Skips the download when a verified file already exists
// (re-hashes it first -- a stale or partial file from a previous failed
// run must not be trusted just because it exists).
//
// Also copies `../distribution/install.ps1` into
// `src-tauri/resources/herdr/install.ps1` -- read-only from this repo's
// point of view; this script only *reads* it, never writes back.
//
// No npm dependencies (spec §7 "No npm additions"): plain `node:https`,
// `node:crypto`, `node:fs`.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
const repoRoot = path.resolve(guiRoot, "..");

const pinPath = path.join(guiRoot, "packaging", "herdr-package.json");
const resourcesDir = path.join(guiRoot, "src-tauri", "resources", "herdr");
const zipPath = path.join(resourcesDir, "herdr-windows-x86_64.zip");
const installPs1Src = path.join(repoRoot, "distribution", "install.ps1");
const installPs1Dest = path.join(resourcesDir, "install.ps1");

async function sha256OfFile(filePath) {
  const hash = createHash("sha256");
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function fileHashMatches(filePath, expectedSha256) {
  try {
    const actual = await sha256OfFile(filePath);
    return actual.toLowerCase() === expectedSha256.toLowerCase();
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} failed: HTTP ${response.statusCode}`));
        return;
      }
      const file = createWriteStream(destPath);
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function main() {
  const pin = JSON.parse(await fs.readFile(pinPath, "utf-8"));
  if (!pin.version || !pin.url || !pin.sha256) {
    throw new Error(`packaging/herdr-package.json is missing version/url/sha256`);
  }

  await fs.mkdir(resourcesDir, { recursive: true });

  if (await fileHashMatches(zipPath, pin.sha256)) {
    console.log(`fetch-herdr-package: ${path.basename(zipPath)} already verified (sha256 matches), skipping download`);
  } else {
    console.log(`fetch-herdr-package: downloading herdr ${pin.version} from ${pin.url}`);
    const tmpPath = `${zipPath}.tmp-${process.pid}`;
    await download(pin.url, tmpPath);
    const actualSha256 = await sha256OfFile(tmpPath);
    if (actualSha256.toLowerCase() !== pin.sha256.toLowerCase()) {
      await fs.rm(tmpPath, { force: true });
      throw new Error(
        `fetch-herdr-package: SHA-256 mismatch for ${pin.url}\n  expected: ${pin.sha256}\n  actual:   ${actualSha256}`,
      );
    }
    await fs.rename(tmpPath, zipPath);
    console.log(`fetch-herdr-package: verified sha256 ${actualSha256}`);
  }

  await fs.copyFile(installPs1Src, installPs1Dest);
  console.log(`fetch-herdr-package: copied install.ps1 -> ${installPs1Dest}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
