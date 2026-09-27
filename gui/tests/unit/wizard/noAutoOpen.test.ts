// Phase 1.6 addendum §11 item 2/§11.5: "No first-run wizard... Remove the
// auto-open on first launch... a check that the wizard never opens on
// startup." Checked at the source level (like `golden.test.ts` reads
// committed fixture bytes) rather than by importing `main.ts` or
// `wizard.ts` directly: both pull in the full chrome bootstrap (appState,
// appDom's `document.getElementById` lookups, the renderer, ...), which
// has no test harness of its own -- the wizard's *own* logic already has
// dedicated pure-logic tests (`logic.test.ts`).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");

describe("no first-run auto-open (spec addendum §11 item 2)", () => {
  it("main.ts never calls a startup auto-open of the wizard", () => {
    const mainSource = readFileSync(join(SRC_DIR, "main.ts"), "utf-8");
    expect(mainSource).not.toMatch(/maybeAutoOpenWizardOnStartup/);
  });

  it("wizard.ts no longer exports a startup auto-open function", () => {
    const wizardSource = readFileSync(join(SRC_DIR, "wizard", "wizard.ts"), "utf-8");
    expect(wizardSource).not.toMatch(/maybeAutoOpenWizardOnStartup/);
  });

  it("the wizard's only trigger is herdr menu ▸ Setup… (openSetupWizard), wired from the menu table", () => {
    const wizardSource = readFileSync(join(SRC_DIR, "wizard", "wizard.ts"), "utf-8");
    expect(wizardSource).toMatch(/export function openSetupWizard/);

    const menuBarSource = readFileSync(join(SRC_DIR, "appMenuBar.ts"), "utf-8");
    expect(menuBarSource).toMatch(/onSetupWizard:\s*\(\)\s*=>\s*openSetupWizard\(\)/);

    const menusSource = readFileSync(join(SRC_DIR, "ui", "menus.ts"), "utf-8");
    expect(menusSource).toMatch(/id:\s*"herdr\.setup"/);
  });
});
