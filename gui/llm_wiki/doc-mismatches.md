# Docs that disagree with the code

The code is truth. Checked 2026-10-24.

| Doc | Says | Code shows |
|---|---|---|
| `PRODUCT.md:28` | A git panel is "planned, not built" | Shipped in commit `caaa2d2b`. See `src-tauri/src/git.rs:392` and `src/ui/sourceControl.ts:157`. |
| `PRODUCT.md:28` | Capability list has no file viewer, SQLite inspector or screen record | `src-tauri/src/files.rs:521`, `src-tauri/src/android_db.rs:922`, `src-tauri/src/record.rs:518` exist. |
| `PRODUCT.md:12`, `PRODUCT.md:32` | macOS is "planned"; scope undecided | `src-tauri/tauri.macos.conf.json` and `src/shortcuts.ts:474` exist. The port is partial ([[macos-port]]). |
| `PRODUCT.md:32` | Native Android project support is undecided | `src-tauri/src/flutter.rs:357-360` detects a native Android project. |
| `docs/phase1_7-plan.md:3` | "Nothing is built"; app named `Herdr Desktop.app` | The product name is Cowbell (`src-tauri/tauri.conf.json:3`). A macOS build command exists ([[build-test]]). |
| `docs/flutter-run-spec.md:9` | Flavors, mirror, screenshot and recording are out of scope | All exist: `flutter.rs:581`, `android.rs:125`, `android.rs:315`, `record.rs:518`. |
| `docs/mirror-toolbar-spec.md` | No APK install status on the strip | The strip shows the APK install status from scrcpy's log: `mirror_tools.rs` `follow_scrcpy_log` (435), `src/mirrorTools.ts` `mirror-install` listener (404) |
| `docs/device-explorer-spec.md` | The explorer reads `/sdcard` and `/storage`, read-only | Phases 2 and 3 superseded it: writes in Shared storage (`device_explorer.rs` `android_push_paths`, `android_delete_path`, `android_push_dropped`), any readable path, and app data through `run-as`. |
| `docs/git-mvp-spec.md:3` | "Status: plan" | Implemented. |
| `docs/file-viewer-spec.md:3` | "Implementation plan: not written yet" | Implemented (commit `b5925979`, `src/appFiles.ts:183`). |
| `docs/sqlite-inspector-plan.md:3` | "plan only" | Implemented (commit `66ff7e4c`, `src-tauri/src/android_db.rs:922`). |

## Branch note
The task brief named branch `feat/gui-phase1`. The working branch on 2026-10-24 is `feat/git-source-control`. The stash belongs to `feat/gui-phase1`.
