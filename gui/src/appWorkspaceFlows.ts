// New Workspace… (folder picker -> dedup -> `workspace.create`) and the
// VS Code theme import flow (finding #16 extraction from `main.ts`).

import { api, invokeSafe, showErrorNotice } from "./appApi";
import { applyCurrentTheme } from "./appLookups";
import { appState, persistSettings } from "./appState";
import { importedThemeId } from "./themes/index";
import { import_theme_via_picker_safe, list_imported_themes_safe } from "./themeImportClient";
import { findDuplicateWorkspace, prunePersistedFolders, type WorkspaceCwdCandidate } from "./workspace/dedupe";

function basenameOf(folder: string): string {
  return folder.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || folder;
}

export async function newWorkspaceFlow(): Promise<void> {
  const folder = await invokeSafe<string | null>("pick_workspace_folder");
  const snapshot = appState.snapshot;
  if (!folder || !snapshot) return;
  const liveIds = snapshot.workspaces.map((w) => w.workspace_id);
  const persisted = prunePersistedFolders(appState.settings.workspaceFolders, liveIds);
  const candidates: WorkspaceCwdCandidate[] = snapshot.workspaces.map((w) => ({
    workspaceId: w.workspace_id,
    newWorkspaceCwd: w.new_workspace_cwd,
  }));
  const result = findDuplicateWorkspace(folder, persisted, candidates);
  if (result.kind === "focus") {
    void api("workspace.focus", { workspace_id: result.workspaceId });
    return;
  }
  const created = await api<{ workspace: { workspace_id: string } }>("workspace.create", {
    cwd: folder,
    label: basenameOf(folder),
    focus: true,
  });
  if (created?.workspace?.workspace_id) {
    appState.settings.workspaceFolders = { ...appState.settings.workspaceFolders, [created.workspace.workspace_id]: folder };
    persistSettings();
  }
}

export async function refreshImportedThemes(): Promise<void> {
  const imported = await list_imported_themes_safe(invokeSafe);
  appState.themeRegistry.setImported(
    imported.map((t) => ({
      id: importedThemeId(t.slug),
      label: t.name,
      kind: t.type as "light" | "dark" | "hc",
      colors: t.colors,
    })),
  );
}

export async function importThemeFlow(): Promise<void> {
  const report = await import_theme_via_picker_safe(invokeSafe);
  if (!report) return;
  await refreshImportedThemes();
  // Finding #12/spec §2.3/§12: "It applies live" -- an import doesn't just
  // add to the picker list, it becomes the active theme immediately (the
  // first theme when a .vsix imported several).
  const first = report.imported[0];
  if (first) {
    appState.settings.theme = importedThemeId(first.slug);
    applyCurrentTheme();
    persistSettings();
  }
  const parts = [`Imported ${report.imported.length} theme(s)`];
  if (report.skipped_keys > 0) parts.push(`${report.skipped_keys} colour(s) skipped`);
  if (report.errors.length > 0) parts.push(`${report.errors.length} error(s)`);
  showErrorNotice(parts.join(" · "));
}
