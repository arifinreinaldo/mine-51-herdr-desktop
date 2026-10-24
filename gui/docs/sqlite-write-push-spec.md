# Spec: SQLite inspector, write mode, push to device, design fixes

Repo: `C:\Users\Reinaldo\Backend\herdr\gui`. Planned by Opus, approved by the user.

- Call A (Rust): steps 1–4.
- Call B (TS/CSS): steps 5–8. They land together, because `tsc` fails between them.

## Header

**Goal.**
- Part A: write mode on the local copy, a dirty (unpushed edits) state with discard confirms, and `android_push_database`. The push does: force-stop, backup, checkpoint, push, sibling cleanup, SHA-1 check.
- Part B: pager label, table filter, grid fonts, database basename picker, auto-growing SQL box.

**Off limits.**
- `src-tauri/capabilities/*`, `src/ui/confirmPopover.ts`, `src/ui/overlay.ts`, `src/keyboard/focusCapture.ts`.
- `flutter.rs`: keep its pre-existing clippy and fmt issues.
- Every other modified file on the branch.
- Do not run `cargo fmt` on the workspace. Run `rustfmt --edition 2021` on `android_db.rs` only.
- Do not commit.

**Contracts.**
- `android_db_query` gains `write: bool`.
- `QueryPage` gains `wrote: bool`. A write returns `{columns:["Rows changed"], rows:[[String(conn.changes())]], hasMore:false, wrote:true}`.
- `android_push_database(device_id, package_name, db_path)` returns `PushedDatabase { backup_path }` (serde camelCase).
- New error codes: `push_failed`, `push_mismatch`.
- Backup path: `<LOCALAPPDATA or temp>/Cowbell/sqlite-backups/<device_dir_name>/<pkg>/<rel basename>-<YYYYMMDD-HHMMSS UTC>`. Use `crate::android::local_app_data()` (android.rs:32).
- Device tmp file: `/data/local/tmp/cowbell-<pkg>.sqlite`.
- Hash: toybox `sha1sum` against the Rust `sha1` crate. `sha1 0.10.7` is already in Cargo.lock through `zip`.

**Edge cases.**
- Write mode allows `VACUUM INTO` and `ATTACH`: the SQL is the local user's own, on the user's own machine.
- One statement only: `prepare` rejects a statement with a tail (`sql_error`).
- A failing statement or a write never becomes `sql`: Refresh and the pager re-run `sql`.
- `showPage` shows `pulledText` again, so the push result goes into `pulledText`.
- `.icon-btn { display:grid }` beats `[hidden]`, so the chevrons need a `[hidden]` rule.
- `.db-result .db-num` also matches `th`. The mono font goes on `td.db-num` only.
- The confirm popover is positioned against `root`. `.db-root` needs `position: relative`.
- `focusKeyboardCapture()` is a no-op on this page. Refocus the anchor on cancel.
- No capability file covers `db-inspector-*`, so there is no window-close confirm. Leave a shortcut comment.

**Counterintuitive.**
- `adb push` prints its summary on stdout, so judge it by the exit code only.
- Silent `adb shell` commands (`am force-stop`, `run-as cp`, `rm -f`) fail on a non-zero exit or on any output.
- The local checkpoint and hash run first, so a broken copy fails before the app is force-stopped.
- The backup timestamp is in UTC (`statusline::civil_from_unix_utc`).
- `confirmDiscard` must be an arrow `const`. A nested `function` loses the null-narrowing of `root` (TS18047).

---

### Step 1: add the sha1 dependency and expose the calendar helper (mechanical)

**1a. `src-tauri/Cargo.toml`.** After the line `rusqlite = { version = "0.40.2", features = ["bundled"] }`, insert:

```toml
# Push check (`android_db.rs`): SHA-1 of the local copy, compared with the
# device's toybox `sha1sum`. Already in the tree through `zip`.
sha1 = "0.10"
```

**1b. `src-tauri/src/statusline.rs`.** In the doc comment above `fn civil_from_unix_utc` (about lines 141-145), make these replacements:
- `public domain), used only to format the backup` → `public domain), used to format backup`
- `filename's \`yyyyMMddHHmmss\` timestamp (UTC) -- this crate has no` → `file name timestamps (UTC; also android_db.rs) -- this crate has no`
- `fn civil_from_unix_utc(` → `pub(crate) fn civil_from_unix_utc(`

**Verify:**

```
cargo tree --manifest-path src-tauri/Cargo.toml -i sha1@0.10.7 --depth 1
```

This lists herdr-gui and zip, and shows one sha1 version only.

### Step 2: write mode in `query_page` and `android_db_query` (judgment), in `src-tauri/src/android_db.rs`

**2a. Module doc.** Replace lines 1-4 with:

```rust
//! SQLite inspector for adb devices, in copy mode: no agent runs on the
//! device. The list shows the SQLite databases the app holds open now, found
//! through `run-as`, so only debuggable apps work. The database, its `-wal`
//! and `-shm` are pulled to a temp copy. Write mode changes only that copy;
//! `android_push_database` is the one command that writes to the device.
```

**2b. Import.** After `use serde::Serialize;`, add `use sha1::{Digest, Sha1};`.

**2c. Structs.** In `QueryPage`, after `pub has_more: bool,`, add the field below. Then add the new struct after `QueryPage`:

```rust
    /// True when write mode ran a statement that changes the copy.
    pub wrote: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedDatabase {
    pub backup_path: String,
}
```

**2d. Device folder name.** Replace `local_device_dir` with:

```rust
/// The device id as a folder name. `:` (Wi-Fi adb) is not allowed in a
/// Windows path, and `..` passes `is_valid_device_id`.
fn device_dir_name(device_id: &str) -> String {
    device_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// `<temp>/cowbell-sqlite/<device>`.
fn local_device_dir(device_id: &str) -> PathBuf {
    local_root().join(device_dir_name(device_id))
}
```

**2e. `open_copy`.** It becomes:

```rust
/// A fresh connection per call, read-only unless `write` (never CREATE):
/// nothing holds the files open when Refresh deletes and pulls them (Windows file locks).
fn open_copy(path: &Path, write: bool) -> Result<Connection, ApiError> {
    if !path.is_file() {
        return Err(api_error("not_pulled", "Pull the database first"));
    }
    let mode = if write {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(sql_error)
}
```

In `read_tables`, change the call to `open_copy(path, false)?`.

**2f. `query_page`.**
- The signature becomes `pub fn query_page(path: &Path, sql: &str, offset: usize, write: bool) -> Result<QueryPage, ApiError>`.
- Call `open_copy(path, write)?`.
- Replace the block that starts at the comment `// The connection is read-only, but VACUUM INTO still writes a new file.` and runs through its closing `}` with:

```rust
    if !stmt.readonly() {
        // Read mode: the connection is read-only, but VACUUM INTO still writes a new file.
        if !write {
            return Err(api_error(
                "read_only",
                "Only read-only statements run on the copy. Turn on Write mode to change it",
            ));
        }
        // Step to the end so the whole statement runs; RETURNING rows are dropped.
        let mut rows = stmt.query([]).map_err(sql_error)?;
        while rows.next().map_err(sql_error)?.is_some() {}
        return Ok(QueryPage {
            columns: vec!["Rows changed".to_string()],
            rows: vec![vec![Some(conn.changes().to_string())]],
            has_more: false,
            wrote: true,
        });
    }
```

- The final `Ok(QueryPage {..})` gains `wrote: false,`.
- If the borrow checker objects (`rows` borrows `stmt`), scope `rows` in a block before `conn.changes()`.

**2g. `android_db_query`.**
- Doc: `/// Runs one statement on the local copy, up to \`PAGE_ROWS\` rows from \`offset\`. Read-only unless \`write\`.`
- Add the parameter `write: bool` after `offset: usize,`.
- Call `query_page(&path, &sql, offset, write)`.

**2h. Tests.**
- Add a trailing `false` argument to every existing `query_page(` call in `mod tests`, including `query_without_a_pull_is_not_pulled` (via `android_db_query`).
- Add this test:

```rust
    #[test]
    fn write_mode_changes_the_copy_one_statement_at_a_time() {
        let db = table_db("write", "CREATE TABLE t(x); INSERT INTO t VALUES (1), (2)");
        let page = query_page(&db, "UPDATE t SET x = x + 10", 0, true).unwrap();
        assert_eq!(page.columns, ["Rows changed"]);
        assert_eq!(page.rows, vec![vec![Some("2".to_string())]]);
        assert!(page.wrote);
        let read = query_page(&db, "SELECT x FROM t ORDER BY x", 0, true).unwrap();
        assert!(!read.wrote);
        assert_eq!(read.rows, vec![vec![Some("11".to_string())], vec![Some("12".to_string())]]);
        let code = |sql: &str, write| query_page(&db, sql, 0, write).unwrap_err().code;
        assert_eq!(code("DELETE FROM t", false), "read_only");
        assert_eq!(code("DELETE FROM t; DROP TABLE t", true), "sql_error");
        assert_eq!(query_page(&db, "SELECT count(*) FROM t", 0, false).unwrap().rows[0][0].as_deref(), Some("2"));
    }
```

### Step 3: `android_push_database` and its pure helpers (judgment), in `src-tauri/src/android_db.rs`

**3a.** After `sqlite_paths`, insert:

```rust
/// The failure text of an `adb shell` command that prints nothing on success,
/// or `None`. Old adb merges stderr into stdout and always exits 0, so any
/// output counts as a failure too.
pub fn shell_failure(success: bool, stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let text = format!(
        "{} {}",
        String::from_utf8_lossy(stderr).trim(),
        String::from_utf8_lossy(stdout).trim()
    );
    let text: String = text.trim().chars().take(STDERR_MAX_CHARS).collect();
    match (success, text.is_empty()) {
        (true, true) => None,
        (false, true) => Some("adb shell failed".to_string()),
        _ => Some(text),
    }
}

/// The lower-case digest from toybox `sha1sum <file>` output (`<40 hex>  <file>`).
pub fn parse_sha1sum(out: &str) -> Option<String> {
    let token = out.split_whitespace().next()?;
    (token.len() == 40 && token.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| token.to_ascii_lowercase())
}

/// `run-as <package> <cmd…>` for `adb shell`. Every part is a validated name
/// or a fixed word, so the device `sh` sees no metacharacter.
pub fn run_as<'a>(package: &'a str, cmd: &[&'a str]) -> Vec<&'a str> {
    let mut argv = vec!["run-as", package];
    argv.extend_from_slice(cmd);
    argv
}

/// adb push cannot write into the app folder; `run-as cp` copies from here.
pub fn device_tmp_path(package: &str) -> String {
    format!("/data/local/tmp/cowbell-{package}.sqlite")
}

/// `<base>/Cowbell/sqlite-backups/<device>/<package>/<file name>-<YYYYMMDD-HHMMSS>`,
/// the time in UTC like the statusline.rs backups. Its `-wal` and `-shm` sit beside it.
// shortcut: backups are never pruned; add a keep-last-N if the folder grows.
pub fn backup_path(base: &Path, device_id: &str, package: &str, rel: &str, epoch_secs: i64) -> PathBuf {
    let (year, month, day, hour, minute, second) = crate::statusline::civil_from_unix_utc(epoch_secs);
    let name = rel.rsplit('/').next().unwrap_or(rel);
    base.join("Cowbell")
        .join("sqlite-backups")
        .join(device_dir_name(device_id))
        .join(package)
        .join(format!("{name}-{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}"))
}
```

Check the real signature and return types of `civil_from_unix_utc` first, and adapt the destructuring if they differ.

**3b.** After `trimmed_stderr`, insert:

```rust
/// Runs `adb shell <args>` for a command that prints nothing on success.
async fn adb_shell(adb: &Path, device_id: &str, args: &[&str], timeout: Duration) -> Result<(), ApiError> {
    let mut cmd = adb_command(adb, device_id);
    cmd.arg("shell").args(args);
    let out = adb_output(cmd, timeout).await?;
    match shell_failure(out.status.success(), &out.stdout, &out.stderr) {
        Some(text) => Err(api_error("push_failed", text)),
        None => Ok(()),
    }
}
```

**3c.** After `read_tables`, insert:

```rust
/// Folds the `-wal` into the database file, so the one file holds every
/// change. The header keeps WAL mode; the close deletes the emptied `-wal`.
fn checkpoint(path: &Path) -> Result<(), ApiError> {
    open_copy(path, true)?
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(sql_error)
}

/// Lower-case hex SHA-1 of a local file: the same text as toybox `sha1sum`.
fn file_sha1(path: &Path) -> Result<String, ApiError> {
    let io = |e: std::io::Error| api_error("io_error", e.to_string());
    let mut hasher = Sha1::new();
    std::io::copy(&mut std::fs::File::open(path).map_err(io)?, &mut hasher).map_err(io)?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
```

**3d.** After `android_db_query`, insert:

```rust
/// Steps e–g of a push: copy in through `/data/local/tmp`, delete the stale
/// `-wal`/`-shm`/`-journal`, then compare the device SHA-1 with `local_sum`.
async fn replace_device_db(
    adb: &Path,
    device_id: &str,
    package: &str,
    rel: &str,
    local: &Path,
    local_sum: &str,
) -> Result<(), ApiError> {
    let tmp = device_tmp_path(package);
    let mut push = adb_command(adb, device_id);
    push.arg("push").arg(local).arg(&tmp);
    // adb push prints its transfer summary on stdout: only the exit code counts.
    let copied = match adb_output(push, PULL_TIMEOUT).await {
        Ok(out) if out.status.success() => {
            adb_shell(adb, device_id, &run_as(package, &["cp", &tmp, rel]), PULL_TIMEOUT).await
        }
        Ok(out) => Err(api_error(
            "push_failed",
            format!("adb push failed: {}", trimmed_stderr(&out)),
        )),
        Err(err) => Err(err),
    };
    // The tmp file is app data in a folder every shell user can read.
    let _ = adb_shell(adb, device_id, &["rm", "-f", &tmp], ADB_TIMEOUT).await;
    copied?;
    let (wal, shm, journal) = (
        format!("{rel}-wal"),
        format!("{rel}-shm"),
        format!("{rel}-journal"),
    );
    adb_shell(adb, device_id, &run_as(package, &["rm", "-f", &wal, &shm, &journal]), ADB_TIMEOUT)
        .await?;
    let mut sum = adb_command(adb, device_id);
    sum.arg("shell").args(run_as(package, &["sha1sum", rel]));
    let out = adb_output(sum, PULL_TIMEOUT).await?;
    let text = String::from_utf8_lossy(&out.stdout);
    match parse_sha1sum(&text) {
        Some(device_sum) if device_sum == local_sum => Ok(()),
        Some(_) => Err(api_error(
            "push_mismatch",
            "The device database does not match the pushed copy",
        )),
        None => Err(api_error(
            "push_failed",
            format!("sha1sum failed: {} {}", text.trim(), trimmed_stderr(&out))
                .trim()
                .to_string(),
        )),
    }
}

/// Copies the edited local copy over the app's database and returns the
/// backup path. In order: checkpoint and hash the copy, force-stop the app,
/// back up the device database, then `replace_device_db`.
#[tauri::command]
pub async fn android_push_database(
    device_id: String,
    package_name: String,
    db_path: String,
) -> Result<PushedDatabase, ApiError> {
    check_target(&device_id, &package_name, Some(&db_path))?;
    let local = local_db_path(&device_id, &package_name, &db_path);
    // Local work first: a missing or broken copy fails before the app is stopped.
    let copy = local.clone();
    let local_sum = tokio::task::spawn_blocking(move || {
        checkpoint(&copy)?;
        file_sha1(&copy)
    })
    .await
    .map_err(|e| api_error("io_error", e.to_string()))??;
    let adb = adb_path()?;
    adb_shell(&adb, &device_id, &["am", "force-stop", &package_name], ADB_TIMEOUT).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let base = crate::android::local_app_data().unwrap_or_else(std::env::temp_dir);
    let backup = backup_path(&base, &device_id, &package_name, &db_path, now);
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent).map_err(|e| api_error("io_error", e.to_string()))?;
    }
    if let Err(err) = pull_all(&adb, &device_id, &package_name, &db_path, &backup).await {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(sibling(&backup, suffix));
        }
        return Err(api_error(
            &err.code,
            format!("Backup failed, nothing was pushed: {}", err.message),
        ));
    }
    let saved = backup.to_string_lossy().into_owned();
    replace_device_db(&adb, &device_id, &package_name, &db_path, &local, &local_sum)
        .await
        .map_err(|err| api_error(&err.code, format!("{} (backup: {saved})", err.message)))?;
    Ok(PushedDatabase { backup_path: saved })
}
```

Adapt `api_error` and `local_app_data` to their real signatures. For example, `api_error` may take `&'static str` for the code; in that case, keep the code string some other way, without changing `api_error`'s signature.

**3e. Tests.**
- In `commands_reject_unsafe_input_before_adb`, add:

```rust
let err = android_push_database("RF8W3085JEW".into(), "com.x".into(), "../x".into()).await.unwrap_err();
assert_eq!(err.code, "bad_db_path");
```

- At the end of `query_without_a_pull_is_not_pulled`, add:

```rust
let err = android_push_database("RF8W3085JEW".into(), "com.never.pulled".into(), "files/none.db".into()).await.unwrap_err();
assert_eq!(err.code, "not_pulled");
```

- Add these tests:

```rust
    #[test]
    fn shell_failure_treats_any_output_as_an_error() {
        assert_eq!(shell_failure(true, b"", b" \n"), None);
        assert_eq!(
            shell_failure(true, b"run-as: package not debuggable: com.x\n", b"").as_deref(),
            Some("run-as: package not debuggable: com.x")
        );
        assert_eq!(
            shell_failure(false, b"", b"cp: x: Permission denied\n").as_deref(),
            Some("cp: x: Permission denied")
        );
        assert_eq!(shell_failure(false, b"", b"").as_deref(), Some("adb shell failed"));
    }

    #[test]
    fn parse_sha1sum_reads_the_digest_only() {
        assert_eq!(
            parse_sha1sum("A9993E364706816ABA3E25717850C26C9CD0D89D  files/x.db\n").as_deref(),
            Some("a9993e364706816aba3e25717850c26c9cd0d89d")
        );
        assert_eq!(parse_sha1sum("run-as: package not debuggable: com.x\n"), None);
        assert_eq!(parse_sha1sum("sha1sum: files/x.db: No such file or directory"), None);
        assert_eq!(parse_sha1sum(""), None);
    }

    #[test]
    fn push_argv_and_paths_use_validated_names() {
        assert_eq!(
            run_as("com.x", &["cp", "/data/local/tmp/cowbell-com.x.sqlite", "files/a.db"]),
            ["run-as", "com.x", "cp", "/data/local/tmp/cowbell-com.x.sqlite", "files/a.db"]
        );
        assert_eq!(device_tmp_path("com.x"), "/data/local/tmp/cowbell-com.x.sqlite");
        // 1_792_664_130 = 2026-10-22 10:15:30 UTC
        let path = backup_path(Path::new("base"), "192.168.1.5:5555", "com.x", "files/databases/a.sqlite", 1_792_664_130);
        assert_eq!(
            path,
            Path::new("base").join("Cowbell").join("sqlite-backups").join("192_168_1_5_5555").join("com.x").join("a.sqlite-20261022-101530")
        );
    }

    #[test]
    fn file_sha1_matches_sha1sum() {
        let file = scratch("sha1").join("abc");
        std::fs::write(&file, "abc").unwrap();
        assert_eq!(file_sha1(&file).unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
    }

    #[test]
    fn checkpoint_folds_the_wal_and_keeps_wal_mode() {
        let (src, dst) = (scratch("ckpt-src"), scratch("ckpt-dst"));
        let db = src.join("t.db");
        let writer = Connection::open(&db).unwrap();
        writer.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0)).unwrap();
        writer.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1), (2), (3)").unwrap();
        // Copy while the writer is open: closing it would checkpoint the WAL.
        std::fs::copy(&db, dst.join("t.db")).unwrap();
        std::fs::copy(src.join("t.db-wal"), dst.join("t.db-wal")).unwrap();
        drop(writer);
        let copy = dst.join("t.db");
        checkpoint(&copy).unwrap();
        let wal = sibling(&copy, "-wal");
        assert!(!wal.exists() || std::fs::metadata(&wal).unwrap().len() == 0);
        let alone = scratch("ckpt-alone").join("t.db");
        std::fs::copy(&copy, &alone).unwrap();
        assert_eq!(&std::fs::read(&alone).unwrap()[18..20], &[2u8, 2][..], "WAL mode stays in the header");
        assert_eq!(query_page(&alone, "SELECT x FROM t", 0, false).unwrap().rows.len(), 3);
    }
```

- Check how `scratch()` works (whether it returns a dir or a file path) and adapt.
- Then run `rustfmt --edition 2021 src-tauri/src/android_db.rs`.

### Step 4: register the command (mechanical)

In `src-tauri/src/lib.rs`, after `android_db::android_db_query,`, add `android_db::android_push_database,`.

**Verify steps 2–4:**

```
cargo test --manifest-path src-tauri/Cargo.toml android_db
rustfmt --edition 2021 --check src-tauri/src/android_db.rs
```

If `target` is locked, add `--target-dir target-agent`.

### Step 5: `rowRange` and `baseName` (mechanical)

**5a.** In `src/android/dbFormat.ts`, replace `rowRange` with:

```ts
/** "21 rows" ("1 row") when one page holds every row, else "Rows 101–200"; "No rows" when empty. */
export function rowRange(offset: number, count: number, hasMore: boolean): string {
  if (count === 0) return "No rows";
  if (offset === 0 && !hasMore) return count === 1 ? "1 row" : `${count} rows`;
  return `Rows ${offset + 1}–${offset + count}`;
}

/** The last path segment: `files/databases/a.sqlite` → `a.sqlite`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
```

Keep the existing empty-page behavior if it differs ("No rows" is assumed here; check the current function).

**5b.** In `tests/unit/dbFormat.test.ts`:
- Import `baseName`.
- Replace the `rowRange` describe block with:

```ts
describe("rowRange", () => {
  it("is No rows for an empty page", () => expect(rowRange(0, 0, false)).toBe("No rows"));
  it("counts the rows when one page holds them all", () => {
    expect(rowRange(0, 21, false)).toBe("21 rows");
    expect(rowRange(0, 1, false)).toBe("1 row");
  });
  it("is one-based and inclusive across pages", () => {
    expect(rowRange(0, 100, true)).toBe("Rows 1–100");
    expect(rowRange(100, 37, false)).toBe("Rows 101–137");
  });
});

describe("baseName", () => {
  it("keeps the last segment", () => expect(baseName("files/databases/a.sqlite")).toBe("a.sqlite"));
  it("keeps a bare name", () => expect(baseName("logdb.sqlite")).toBe("logdb.sqlite"));
});
```

### Step 6: TS API wrappers (mechanical), in `src/flutter/flutterApi.ts`

In `QueryPage`, after `hasMore: boolean;`, add:

```ts
  /** True when write mode ran a statement that changed the copy: one "Rows changed" row. */
  wrote: boolean;
```

Replace `androidDbQuery` with the code below, and add the push API after it:

```ts
/** Runs one statement on the local copy, up to 100 rows from `offset`. Read-only unless `write`. */
export function androidDbQuery(deviceId: string, packageName: string, dbPath: string, sql: string, offset: number, write: boolean): Promise<QueryPage> {
  return invoke<QueryPage>("android_db_query", { deviceId, packageName, dbPath, sql, offset, write });
}

export interface PushedDatabase {
  /** The device database as it was before the push, for a tooltip. */
  backupPath: string;
}

/** Force-stops the app, backs up its database, copies the local copy over it and checks the SHA-1. */
export function androidPushDatabase(deviceId: string, packageName: string, dbPath: string): Promise<PushedDatabase> {
  return invoke<PushedDatabase>("android_push_database", { deviceId, packageName, dbPath });
}
```

### Step 7: CSS (mechanical), in `src/style.css`, the `.db-*` block only

- **`.db-root`:** add `position: relative;`.
- **After `.db-status {…}`, add:**

```css
/* Unpushed edits in write mode. No `display`: the hidden attribute must work. */
.db-dirty {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--charts-orange);
  border-radius: 4px;
  color: var(--charts-orange);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
```

- **After `.db-side__count {…}`, add:**

```css
.db-filter {
  height: 24px;
  margin: 0 8px 6px;
  padding: 0 6px;
  flex-shrink: 0;
  background: var(--menu-background);
  color: var(--menu-foreground);
  border: 1px solid var(--menu-border);
  border-radius: 4px;
  font: inherit;
  font-size: var(--fs-xs);
}

.db-filter::placeholder {
  color: var(--descriptionForeground);
}

.db-filter:focus {
  outline: none;
  border-color: var(--focusBorder);
}

.db-filter[hidden] {
  display: none;
}
```

- **`.db-table`:** add `font-size: var(--fs-xs);`.
- **`.db-sql`:**
  - `min-height: 58px` → `28px`
  - `max-height: 40vh` → `154px` (8 lines)
  - `padding: 6px 8px` → `4px 8px`
  - `resize: vertical` → `resize: none`
- **After `.db-sql:focus {…}`, add:**

```css
.db-write {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--descriptionForeground);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.db-write input {
  accent-color: var(--focusBorder);
  cursor: inherit;
}
```

- **`.db-result`:** the font becomes `font: 12px/1.5 var(--ui-font);`. Keep `font-variant-numeric: tabular-nums`.
- **After `.db-result .db-num {…}`, add:**

```css
/* td only: `.db-num` is on numeric headers too, and they keep the UI font. */
.db-result td.db-num {
  font-family: "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace;
}
```

- **After `.db-page-btn:hover:not(:disabled) {…}`, add:**

```css
/* `.icon-btn` sets display: grid, which beats the hidden attribute. */
.db-page-btn[hidden] {
  display: none;
}
```

- Check that `--fs-xs`, `--ui-font` and `--descriptionForeground` exist in style.css. If one does not exist, use the value that the `.db-*` block already uses.

### Step 8: inspector page logic (judgment), in `src/dbInspector.ts`

1. **Header comment, lines 1-2:**

```ts
// The SQLite inspector page: pick a running app on an adb device, pick one of
// the databases it holds open, pull a local copy, browse and query it. Write
// mode edits the copy; Push to device copies it back over the app's database.
```

2. **Imports.**
   - Add `baseName` to the dbFormat import.
   - Add `androidPushDatabase` to the flutterApi import.
   - Add `import { openConfirmPopover } from "./ui/confirmPopover";`.
3. **`fillSelect`.**
   - It gains a last parameter `label = (value: string) => value`.
   - The option text uses `label(value)`.
   - The db picker calls pass `baseName` as `label`.
4. **State.** After `let pulledText = "";`, add:

```ts
  // shortcut: closing the window drops unpushed edits without a confirm. onCloseRequested needs a new
  // capabilities/db-inspector.json granting core:event:allow-listen and core:window:allow-destroy; add it if users lose edits.
  let dirty = false;
```

5. **Toolbar.** After `refreshBtn.title`, add the code below. Then `bar.append(field(...app), field(...db), refreshBtn, pushBtn, dirtyBadge, status, progress)`.

```ts
  const pushBtn = button("btn db-btn", "Push to device", "cloud-upload");
  pushBtn.title = "Copy the edited database back over the app's database";
  const dirtyBadge = el("span", "db-dirty", "Not pushed");
```

6. **Sidebar.** Before `tableList`, add the code below. Then `side.append(sideHead, filterInput, tableList)`.

```ts
  const filterInput = el("input", "db-filter");
  filterInput.type = "text";
  filterInput.spellcheck = false;
  filterInput.placeholder = "Filter tables";
  filterInput.setAttribute("aria-label", "Filter tables");
```

7. **Query row.** `sqlBox.rows = 1;`. The query row becomes:

```ts
  const writeBox = el("input");
  writeBox.type = "checkbox";
  const writeToggle = el("label", "db-write");
  writeToggle.title = "Also run statements that change the local copy. Push to device sends the copy to the phone";
  writeToggle.append(writeBox, el("span", undefined, "Write mode"));
  const query = el("div", "db-query");
  query.append(sqlBox, writeToggle, runBtn);
```

8. **`renderEmpty`.** `"Choose a database to pull a read-only copy"` → `"Choose a database to pull a local copy"`.
9. **`renderControls`.** After `nextBtn.disabled = ...`, add the first block below. After `renderControls`, add `fitSql`:

```ts
    prevBtn.hidden = nextBtn.hidden = offset === 0 && !hasMore;
    pushBtn.disabled = busy || !dirty;
    dirtyBadge.hidden = !dirty;
    // state wins: a cancelled or superseded discard confirm leaves a select on the new value
    appSelect.value = app ?? "";
    dbSelect.value = dbPath ?? "";
    dbSelect.title = dbPath ?? "";
```

```ts
  /** Grows the SQL box with its text; the CSS max-height caps it at 8 lines. */
  function fitSql(): void {
    sqlBox.style.height = "auto";
    sqlBox.style.height = `${sqlBox.scrollHeight + 2}px`; // + the two 1px borders (border-box)
  }
```

10. **`renderTables`.**
    - Replace the count line and the loop header with:

```ts
    const filter = filterInput.value.trim().toLowerCase();
    const shown = tables.filter((name) => name.toLowerCase().includes(filter));
    tableCount.textContent = tables.length === 0 ? "" : filter ? `${shown.length} / ${tables.length}` : String(tables.length);
    filterInput.hidden = tables.length === 0;
    for (const name of shown) {
```

    - The table click body becomes:

```ts
          sqlBox.value = tableSql(name);
          fitSql();
          return showPage(0, sqlBox.value);
```

11. **`showPage`.** It becomes:

```ts
  /** Runs `statement` from row `off`. Only a read becomes `sql`: Refresh and the pager re-run `sql`, and a write must not run twice. */
  async function showPage(off: number, statement = sql): Promise<void> {
    const page = await androidDbQuery(id, app!, dbPath!, statement, off, writeBox.checked);
    sql = page.wrote ? "" : statement;
    if (page.wrote) dirty = true;
    offset = off;
    hasMore = page.hasMore;
    renderGrid(page);
    range.textContent = rowRange(off, page.rows.length, page.hasMore);
    renderTables();
    setStatus(pulledText, false, status.title);
  }
```

    Keep the existing tail lines of `showPage`.

12. **`resetDb`.** After `dbPath = null;`, add `dirty = false;` and `filterInput.value = "";`.
13. **`refresh`.** After `setStatus(\`Pulling ${dbPath}…\`);`, add `dirty = false; // the pull replaces the copy, or deletes it when it fails`.
14. **Listeners.** Replace the app/db change listeners, the refresh listener, the `sqlBox` input listener and the `runBtn` listener with the code below. Keep the `sqlBox` keydown (Ctrl+Enter) listener and the prev/next listeners as they are.

```ts
  /** Runs `proceed` now, or after a "Discard changes" confirm while the copy has unpushed edits. */
  const confirmDiscard = (anchor: HTMLElement, proceed: () => void): void => {
    if (!dirty) {
      proceed();
      return;
    }
    openConfirmPopover(root, anchor, {
      titlePrefix: "Discard changes to ",
      titleName: baseName(dbPath ?? ""),
      titleSuffix: "?",
      detail: "Your edits to the local copy are not pushed to the device.",
      confirmLabel: "Discard changes",
      onConfirm: proceed,
      onCancel: () => {
        renderControls();
        anchor.focus();
      },
    });
  };

  appSelect.addEventListener("change", () => {
    const chosen = appSelect.value || null;
    confirmDiscard(appSelect, () => {
      app = chosen;
      resetDb();
      dbs = [];
      fillSelect(dbSelect, "Choose a database", dbs, null);
      void refresh();
    });
  });
  dbSelect.addEventListener("change", () => {
    const chosen = dbSelect.value || null;
    confirmDiscard(dbSelect, () => {
      resetDb();
      dbPath = chosen;
      void refresh();
    });
  });
  refreshBtn.addEventListener("click", () => confirmDiscard(refreshBtn, () => void refresh()));
  pushBtn.addEventListener("click", () => {
    if (!app || !dbPath) return;
    const pkg = app;
    const db = dbPath;
    openConfirmPopover(root, pushBtn, {
      titlePrefix: "Push ",
      titleName: baseName(db),
      titleSuffix: ` to ${params.deviceName}?`,
      detail: `${pkg} will be force-stopped. Its current database is backed up first, then replaced.`,
      confirmLabel: "Push",
      onConfirm: () =>
        void run(async () => {
          setStatus(`Pushing ${db}…`);
          const pushed = await androidPushDatabase(id, pkg, db);
          dirty = false;
          // showPage re-shows pulledText, so the push result lives there too
          pulledText = `Pushed ${new Date().toLocaleTimeString()} · backup saved`;
          setStatus(pulledText, false, pushed.backupPath);
        }),
      onCancel: () => pushBtn.focus(),
    });
  });
  sqlBox.addEventListener("input", () => {
    fitSql();
    renderControls();
  });
  runBtn.addEventListener("click", () => run(() => showPage(0, sqlBox.value.trim())));
  filterInput.addEventListener("input", renderTables);
  filterInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || filterInput.value === "") return;
    filterInput.value = "";
    renderTables();
  });
```

- Check the real `ConfirmPopoverOptions` and `openConfirmPopover` usage in `src/tabClose.ts`, and match it.

**Verify steps 5–8:**

```
npx tsc --noEmit
npx vitest run tests/unit/dbFormat.test.ts
```

---

## Overall verify

```
cargo test --manifest-path src-tauri/Cargo.toml android_db
rustfmt --edition 2021 --check src-tauri/src/android_db.rs
npx tsc --noEmit
npx vitest run
```

## Known limits

- **Closing the window:** unpushed edits are dropped without a confirm.
- **Table list after DDL:** it stays stale until the next pull.
- **Backups:** they are never pruned.
- **No device check yet:** `run-as cp` from `/data/local/tmp` under SELinux has not been run on the real device. Only the live push proves it.
