#!/usr/bin/env node
// Third-party notices generator (Cowbell rebrand spec §D1). Walks the Rust
// dependency graph (`cargo metadata`, normal + build dependencies only,
// never dev) and the two npm packages actually bundled into `dist/`, and
// writes `public/THIRD-PARTY-NOTICES.txt` (Vite copies `public/` to
// `dist/` verbatim, so it ships in the built app and is fetched by the
// Help ▸ Licenses… modal, `src/ui/licensesModal.ts`).
//
// No new npm dependency: plain `node:child_process`, `node:crypto`,
// `node:fs`, `node:path`.
//
// `npm run notices` runs this directly; `scripts/package.mjs` runs it
// before every packaged build.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
const repoRoot = path.resolve(guiRoot, "..");
const srcTauriDir = path.join(guiRoot, "src-tauri");
const outPath = path.join(guiRoot, "public", "THIRD-PARTY-NOTICES.txt");

// ------------------------------------------------------------------ util

const LICENSE_FILE_PREFIXES = ["license", "licence", "copying", "notice"];

function isLicenseFileName(fileName) {
  const lower = fileName.toLowerCase();
  return LICENSE_FILE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Reads every `LICENSE*`/`LICENCE*`/`COPYING*`/`NOTICE*` file directly
 * inside `dir` (not recursive -- a vendored crate/npm package keeps its
 * license files at its own root), in a stable (sorted) order. Bodies are
 * CRLF-normalized so the same text dedups across packages. `[]` when the
 * directory has none, or doesn't exist. */
function readLicenseFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => e.isFile() && isLicenseFileName(e.name))
    .map((e) => e.name)
    .sort();
  return names.map((name) => fs.readFileSync(path.join(dir, name), "utf-8").replace(/\r\n/g, "\n").trimEnd());
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------- Rust packages

function loadCargoMetadata() {
  const raw = execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--offline",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
      "--manifest-path",
      path.join(srcTauriDir, "Cargo.toml"),
    ],
    { cwd: srcTauriDir, encoding: "utf-8", maxBuffer: 128 * 1024 * 1024 },
  );
  return JSON.parse(raw);
}

/** True unless every `dep_kinds` entry on this edge is `"dev"` (spec D1:
 * "normal and build dependencies (not dev)"). An edge with no `dep_kinds`
 * at all (older metadata shape) is normal by convention. */
function edgeIsNormalOrBuild(dep) {
  const kinds = dep.dep_kinds ?? [];
  if (kinds.length === 0) return true;
  return kinds.some((k) => k.kind === null || k.kind === "normal" || k.kind === "build");
}

/** Walks the resolve graph from the root package (`herdr-gui`) over
 * normal + build edges only, returning every reachable package id
 * (including the root itself). */
function reachablePackageIds(metadata) {
  const root = metadata.resolve.root;
  if (!root) {
    throw new Error("cargo metadata: no resolve.root");
  }
  const nodesById = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodesById.get(id);
    for (const dep of node?.deps ?? []) {
      if (edgeIsNormalOrBuild(dep)) stack.push(dep.pkg);
    }
  }
  return seen;
}

/** One dependency's notice entry: name/version/license/repository plus the
 * text of its own bundled license files. */
function rustPackageEntries(metadata) {
  const ids = reachablePackageIds(metadata);
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const entries = [];
  for (const id of ids) {
    const pkg = byId.get(id);
    // Local workspace/path crates (herdr-gui itself, herdr-wire) are
    // first-party, not third-party: `source` is null only for those.
    if (!pkg || !pkg.source) continue;
    const dir = path.dirname(pkg.manifest_path);
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? (pkg.license_file ? `see ${pkg.license_file}` : "UNKNOWN"),
      repository: pkg.repository ?? "",
      licenseFiles: readLicenseFiles(dir),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return entries;
}

// ----------------------------------------------------------- npm packages

/** Only the packages actually bundled into `dist/` (spec D1): the rest of
 * `devDependencies` are build/test tooling, never shipped. */
const BUNDLED_NPM_PACKAGES = ["@vscode/codicons", "@tauri-apps/api"];

function npmPackageEntries() {
  return BUNDLED_NPM_PACKAGES.map((name) => {
    const dir = path.join(guiRoot, "node_modules", name);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
    const repository =
      typeof pkgJson.repository === "string" ? pkgJson.repository : (pkgJson.repository?.url ?? "");
    return {
      name,
      version: pkgJson.version,
      license: pkgJson.license ?? "UNKNOWN",
      repository,
      licenseFiles: readLicenseFiles(dir),
    };
  });
}

// ------------------------------------------------------------- rendering

/** Lists each package once, then each distinct license text once with the
 * packages that ship it (spec D1 "Deduplicate identical licence texts.
 * List the packages that share a text above it"). Dedup is per file text,
 * so the common Apache-2.0 / MIT bodies appear once per section. */
function renderSection(title, entries) {
  const texts = new Map(); // sha256 -> { id, body, users }
  const lines = [];
  for (const entry of entries) {
    const refs = [];
    for (const body of entry.licenseFiles) {
      const key = sha256(body);
      if (!texts.has(key)) texts.set(key, { id: texts.size + 1, body, users: [] });
      const text = texts.get(key);
      text.users.push(`${entry.name} ${entry.version}`);
      refs.push(`#${text.id}`);
    }
    lines.push(`${entry.name} ${entry.version} -- ${entry.license}`);
    if (entry.repository) lines.push(`  Repository: ${entry.repository}`);
    lines.push(`  License text: ${refs.length ? refs.join(", ") : "(none bundled with this package)"}`);
  }
  lines.push("", "License texts", "-------------", "");
  for (const text of texts.values()) {
    lines.push(`[#${text.id}] used by: ${text.users.join(", ")}`, "", text.body, "", "-".repeat(72), "");
  }
  const rendered = lines.join("\n");
  return `${title}\n${"=".repeat(title.length)}\n\n${rendered}`;
}

function main() {
  const metadata = loadCargoMetadata();
  const rustEntries = rustPackageEntries(metadata);
  const npmEntries = npmPackageEntries();

  const herdrLicenseText = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf-8").trimEnd();

  const parts = [
    "Cowbell third-party notices",
    "============================",
    "",
    "This file lists every third-party package bundled into Cowbell, and the",
    "license under which each one is distributed. It is generated by",
    "scripts/gen-notices.mjs -- do not edit by hand.",
    "",
    "Cowbell talks to herdr (https://github.com/herdrdev/herdr); herdr is installed separately.",
    "",
    "herdr (Apache-2.0)",
    "===================",
    "",
    herdrLicenseText,
    "",
    renderSection(`Rust crates (${rustEntries.length} packages)`, rustEntries),
    "",
    "Codicons",
    "========",
    "",
    "Cowbell's icon font is Codicons, (c) Microsoft Corporation, licensed",
    "under CC-BY-4.0 (https://github.com/microsoft/vscode-codicons).",
    "",
    renderSection(`npm packages (${npmEntries.length} packages)`, npmEntries),
  ];

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const output = parts.join("\n").replace(/\n{3,}/g, "\n\n\n").trimEnd() + "\n";
  fs.writeFileSync(outPath, output, "utf-8");

  const lineCount = output.split("\n").length;
  const packageCount = rustEntries.length + npmEntries.length;
  console.log(
    `gen-notices: wrote ${outPath} (${lineCount} lines, ${packageCount} packages: ${rustEntries.length} Rust + ${npmEntries.length} npm)`,
  );
}

main();
