# Terminal render, colors, themes

## Purpose
The frontend draws the herdr grid on a canvas. Theme colors set the 16 ANSI colors.

## Key files
- `src/render/renderer.ts` - `TerminalRenderer` (line 160). Font limits 10-24 px, default 14 (lines 23-25). `FONT_STACK` starts with "SF Mono" (line 22).
- `src/render/atlas.ts`, `boxDrawing.ts`, `metrics.ts`, `runs.ts`, `underline.ts` - glyph atlas, box drawing, cell metrics, text runs, underline.
- `src/colors.ts` - packed color to CSS. `colorKind` (line 39), `cssColor` (line 94), `DEFAULT_PALETTE` (line 18).
- `src/themes/index.ts` - `BUILT_IN_THEMES` (line 27, six themes), `ThemeRegistry` (line 46), `applyThemeById` (line 69), `DEFAULT_THEME_ID` = "dark-modern" (line 14).
- `src/themes/build.ts` - `buildTheme` (line 90) and `ansiEntries` (line 60) write `terminal.ansi*` keys.
- `src/themes/savedTheme.ts` - `applySavedTheme` for secondary windows (line 8).
- `src/appLookups.ts:16` - builds the renderer ANSI list from `terminal.ansi*` theme keys.
- `src-tauri/src/theme_import.rs` - imports VS Code themes: `import_vscode_theme` (line 717), `list_imported_themes` (line 737). Imported ids start with `import:` (`src/themes/index.ts:21`).
- `src-tauri/src/surface_encode.rs`, `src-tauri/src/mirror.rs` - frame encode and grid mirror ([[protocol]]).

## Flow
1. `cssColor` uses the theme palette for named colors 1-16 (`src/render/renderer.ts:184-186`, `src/render/renderer.ts:610-611`).
2. Color 0 means default. The renderer then uses the theme foreground or background.
3. Commit `312095d2` switched ANSI 0-15 from fixed values to the theme palette.

## Edges
- Wire color packing is fixed. Index order follows the wire format (`src/colors.ts:11-17`).
- A hidden window pauses painting (`src/main.ts:165-168`).
- Tests: `tests/unit/colors.test.ts`, `tests/unit/golden.test.ts`, `tests/golden/`.
