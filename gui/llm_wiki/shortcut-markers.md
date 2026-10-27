# `// shortcut:` markers

## Convention
A `// shortcut:` comment marks a deliberate simplification. The text states the ceiling and the upgrade path. Find all with `grep -rn "// shortcut:" src src-tauri/src`. Ignore the object key `shortcut:` in menu code.

## List (checked 2026-10-27)
| Location | Ceiling | Upgrade |
|---|---|---|
| `src/appSourceControl.ts:30` | 3 s poll, no file watcher | notify-based watching |
| `src/appSourceControl.ts:183` | `new_workspace_cwd` follows a `cd` only after herdr learns the cwd | shell-integration hint |
| `src/dbInspector.ts:100` | closing the window drops unpushed edits | needs `capabilities/db-inspector.json` with `core:event:allow-listen` and `core:window:allow-destroy` |
| `src/ui/sourceControl.ts:148` | no virtual list; over 500 changes per group | add a virtual list |
| `src/ui/fileViewer.ts:219` | each page tokenizes from a null state; block comments across pages get wrong colors | carry state across pages |
| `src/files/highlight.ts:3` | lexical only; PHP heredoc and regex literals can mis-color | none stated (spec section 8.4) |
| `src/files/fuzzy.ts:42` | ranks every path on each keystroke | debounce at 50,000 files |
| `src/git/diffParse.ts:9` | combined conflict diffs (`@@@`) render as meta rows | parse them |
| `src/links.ts:46` | file-path links: `C:\` paths without spaces, one row, ASCII columns; `open_local_path` opens only allowlisted document and media types | quoted and spaced paths, wrapped rows |
| `src/keyboard/doubleShift.ts:3` | fixed 400 ms window | make it a setting |
| `src-tauri/src/flutter.rs:359` | only the `app` module is checked | read `settings.gradle` includes |
| `src-tauri/src/git.rs:309` | `kill_on_drop` ends git but not hook grandchildren | job object |
| `src-tauri/src/git.rs:310` | a timeout kill can leave `.git/index.lock` | report the lock path |
| `src-tauri/src/git.rs:496` | a staged rename shows only the new path's diff | pass `orig_path` |
| `src-tauri/src/git.rs:505` | one global lock for stage, unstage, commit | per-repo locks |
| `src-tauri/src/android_db.rs:29` | at most 200 open files in one `head` argv | batches |
| `src-tauri/src/android_db.rs:79` | names with spaces or non-ASCII are rejected | quote for the device `sh` |
| `src-tauri/src/android_db.rs:204` | backups are never pruned | keep-last-N |
| `src-tauri/src/android_db.rs:662` | deep pages step through every earlier row; a runaway query cannot be cancelled | progress handler |

19 markers. A new marker needs a row here.
