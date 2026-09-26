// Thin typed wrappers around the theme-import Tauri commands (spec
// phase1.5 §2.3), so `main.ts` doesn't hand-roll the response shapes.
// Every call goes through the caller's `invokeSafe` (shows a transient
// error notice on failure instead of throwing).

export interface StoredThemeWithSlug {
  slug: string;
  name: string;
  type: string;
  colors: Record<string, string>;
}

export interface ThemeImportReport {
  imported: { slug: string; name: string }[];
  skipped_keys: number;
  errors: string[];
}

type InvokeSafe = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T | undefined>;

/** Picking the file and importing it both happen in Rust, in one command
 * (finding #13): the webview is never handed a path string of its own, so
 * it can never substitute one for an arbitrary path. Resolves to
 * `undefined` when the user cancels the dialog or the call errors. */
export async function import_theme_via_picker_safe(invokeSafe: InvokeSafe): Promise<ThemeImportReport | undefined> {
  return invokeSafe<ThemeImportReport | null>("import_vscode_theme").then((v) => v ?? undefined);
}

export async function list_imported_themes_safe(invokeSafe: InvokeSafe): Promise<StoredThemeWithSlug[]> {
  return (await invokeSafe<StoredThemeWithSlug[]>("list_imported_themes")) ?? [];
}
