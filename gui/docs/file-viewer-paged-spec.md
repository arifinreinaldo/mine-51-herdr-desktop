# Spec: file viewer freshness, virtual rows, hybrid paged mode, find over all lines (amended)

## Amendments (review findings the user accepted)

1. **Scroll anchor.**
   - `TabView.scrollTop` (pixels) is replaced by `TabView.topLine`, the fractional line at the viewport top.
   - `place()` derives `scrollTop` from `topLine` on each render, refresh and resize.
   - A guard stops the scroll event caused by `place()` itself from moving the anchor.
   - New jsdom test: in scaled mode the line count grows and the top line stays.
2. **Abandoned backend search.**
   - `cancelBackend()` calls `fsSearch(..., "")`. In Rust, an empty query bumps the search generation and returns at once.
   - It runs on close, on an empty query, and on every hide. This includes the direct hide by the diff view, through the existing `MutationObserver`. Tab close and tab switch go through `closeViewerFind` already.
   - Rust checks for cancel on every line, and once per 64 KiB buffer while it skips the rest of a cut line (`skip_rest`, which replaces `skip_until` in `next_line`).
3. **Searching state.**
   - While a paged search is due or runs, the bar shows "Searching…". There is no stale count, and Enter does nothing.
   - A backend error other than `cancelled` shows in the bar.
4. **Overflow past the spacer.** `.fv-lines { overflow-y: clip }`. It is `clip`, not `hidden`, and there is no JS clamp. I also added `overflow-anchor: none`. The justification is under "counterintuitive".
5. **Stable horizontal scroll width.**
   - `TabView.widest` stores the widest painted row in px. It only grows, and it is measured once per row rebuild.
   - It lives in the view, so a refresh keeps it. New test.
6. **Append-only index extension.**
   - `index_for` extends from the last stored offset when the file grew and the byte before that offset is still `\n`. Any other change builds the index again.
   - New Rust tests: extend equals a full build, and the line-start check.
7. **Cut:** the TS `PAGED_THRESHOLD_BYTES` and the old step 5 (the drift test). `appFiles` branches on `result.kind`.
8. **Cut unused contract fields:**
   - `caseSensitive`. The bar has no case toggle; I checked, and it has only the input and the count.
   - `PagedInfo`. `fs_open_paged` now returns the line count as a number.
   - By the same rule, `LineBatch.start`. `fs_read_lines` returns `string[]`, because `start` had no consumer.
9. **Verifies.**
   - Step 4 now runs a wrapper test that checks command names and argument keys.
   - The CSS step parses `style.css` with the jsdom CSSOM and prints the real values.
   - The steps are renumbered because the old step 5 is gone.
10. **Risks added:**
    - Concurrent index scans are not deduplicated.
    - A rewrite that grows a file can be misread as an append.
    - Past roughly 270–640 M lines, scrolling cannot reach every line.

Status: plan only. I ran everything again in the scratch copy with all amendments:
- **TypeScript:** `tsc --noEmit` exits 0.
  - Viewer tests pass 48 of 48: fileViewer 35, viewerFind 12, filesApi 1.
  - The full scratch suite shows 943 passed and 6 failed, 949 in total. All 6 failures are in `golden.test.ts`, because the scratch copy has no `tests/golden` fixtures.
- **Rust:** the revised index, extend, skip and search code compiles standalone. It passes its probe tests with `rustc -D warnings` and `clippy-driver -D warnings`.
- **CSS:** the planned CSS parses in the jsdom CSSOM.
- **Not checked:** the first compile inside the real crate (`tauri::State`, serde, `lib.rs`) happens at the step 1–3 verifies.

Baselines in the real repo:
- `tsc` passes, and vitest passes 75 files / 934 tests.
- `cargo test` passes 364 lib tests; 21 of them are `files::tests`.
- `cargo clippy -- -D warnings` already fails at `src-tauri/src/flutter.rs:498` and `:604`. That code is off-limits.

## Header

**goal**
- The viewer shows the current file on disk:
  - It re-reads on window focus, on a click on the active tab, and when a 2 s `fs_stat` poll sees a change.
  - It renders every line through virtual rows.
  - It opens files of 8 MiB or more in paged mode.
- Ctrl+F finds text anywhere in the file.

**deliverables** (edit the current content; the worktree is dirty)
- `gui/src-tauri/src/files.rs`
- `gui/src-tauri/src/lib.rs`: 2 anchors only
- `gui/src/files/filesApi.ts`
- `gui/tests/unit/files/filesApi.test.ts`: new file
- `gui/src/style.css`: the `.fv-lines` and `.fv-line` rules, plus a new `.fv-window` rule
- `gui/src/ui/fileViewer.ts`
- `gui/tests/unit/ui/fileViewer.test.ts`
- `gui/src/ui/viewerFind.ts`
- `gui/tests/unit/ui/viewerFind.test.ts`
- `gui/src/appFiles.ts`
- `gui/docs/file-viewer-spec.md`
- **Untouched:**
  - everything else, including `flutter.rs` and `docs/file-viewer-impl.md`, which is a historical plan
  - no new dependencies

**contracts**
- Tauri commands. JSON keys are camelCase (`#[serde(rename_all = "camelCase")]`, `files.rs:23-44`). Tauri maps camelCase invoke args to snake_case params.
  - `fs_read_text(root, rel)` returns `{ kind: "text"|"binary"|"paged", content: string|null, size }`.
    - `paged` is returned when `size >= PAGED_THRESHOLD_BYTES` (8 MiB, Rust only) and the first 8 KiB has no NUL. It has no content.
    - `tooLarge` is removed.
  - `fs_stat(root, rel)` returns `{ mtimeMs, size }`.
  - `fs_open_paged(root, rel)` returns a `number`: the line count, at least 1. It builds the index, or extends it after an append.
  - `fs_read_lines(root, rel, start, count)` returns `string[]`.
    - `count` is capped at 1000.
    - Each line has no `\n` or `\r\n`, is cut at 64 KiB, and is decoded as lossy UTF-8.
    - A start past the end returns `[]`.
  - `fs_search(root, rel, query, maxMatches)` returns `{ matches: [{ line, col }], truncated }`.
    - The search is case-insensitive and finds non-overlapping matches, like `findMatches`.
    - `col` counts UTF-16 code units.
    - An empty query bumps the generation and returns no matches. The frontend uses this to stop a search that runs.
  - New error code `cancelled` (`fs_search`). Existing codes stay: `invalid_root`, `outside_root`, `not_found`, `not_a_file`, `io_error`, `fs_failed`.
  - Managed state `files::PagedIndexes`.
- TS `filesApi.ts`:
  - types `FileStat`, `SearchMatch`, `SearchResult`
  - wrappers `fsStat`, `fsOpenPaged` (`Promise<number>`), `fsReadLines` (`Promise<string[]>`), `fsSearch(root, rel, query, maxMatches)`
- TS `fileViewer.ts`:
  - `ViewerContent` loses `tooLarge` and gains `{ kind: "paged"; file: PagedFile }`.
  - `TabView` is `{ topLine; scrollLeft?; widest?; currentLine }`; `scrollTop` is removed.
  - New exports: `PagedFile`, `ViewerText`, `viewerText()`, `onViewerRows(fn)`.
  - `MAX_VIEWER_LINES` is removed.
- TS `viewerFind.ts`: `findMatches(lines: readonly string[], query)`; the other exports are unchanged.

**known risks (header)**
- **OOM.** Bounded, but not only the index map:
  - Text mode (< 8 MiB) holds the string plus a lines array, about 3× the size.
  - The index map holds at most 8 files × 8 bytes per 256 lines. A 10 GB file with 100 M lines uses about 3 MB.
  - The JS page cache plus the previous render's pages hold at most 16 pages × 500 lines × 64 KiB = 512 MiB UTF-8 (about 1 GiB as JS strings). That happens only when every line is 64 KiB or longer.
- **Long lines.** Paged mode does not show or search text past 64 KiB on one line.
- **Full re-index on rewrite.** A multi-GB file that is rewritten (not appended) is indexed again in full at each change, at most one scan per poll.
- **Append misread.** A rewrite that grows the file and still has `\n` just before the last stored offset is taken as an append. The rows can then show wrong lines until a change that fails the check.
- **No build dedup.** `index_for` builds outside the lock with no single-flight. Two page reads of an evicted file can each scan the whole file. The user chose not to dedupe.
- **Selection.** Native selection and copy cover only the rendered rows.
- **Paged colouring.** Each paged page tokenizes from a null state.
- **Lone `\r`.** It is not a line break in paged mode.
- **Scaled scroll.** Files taller than 16 M px (about 888k lines at 18 px rows) map the scroll range in proportion, so a wheel step moves more than one row per pixel.
- **Very long files.** Past roughly 270–640 M lines, scrolling cannot reach every line, because one scroll step spans several lines. Find places rows by line number (`topLine`), not by pixel; this is not tested at that size.
- **mtime granularity.** A same-size rewrite within the same ms is missed by the poll; focus and click still re-read.
- **Paged refresh keeps old matches.** A refresh in paged mode keeps the last search result. The user must edit the query to search the new content.
- **Width.** `widest` grows only when a wide row has painted, and it never shrinks for that tab.

**edge cases**
1. `appFiles.ts:233`: `renderViewer` closes find on every render. Fix: `renderViewer(keepFind)`, and `renderFileViewer` keeps the `.fv-find-bar` node so its input keeps focus.
2. `appFiles.ts:280`: the W3 early return is reversed.
3. `appSourceControl.ts:104` hides the viewer directly.
   - The poll is a permanent `setInterval` gated by `!hidden && !document.hidden` (as in `appSourceControl.ts:225-230`).
   - `readActive` drops renders while the viewer is hidden.
   - The `hidden` `MutationObserver` (`appFiles.ts:212`) now closes find, which also stops its backend search.
4. `appFiles.ts:153`: state is deleted without `closeTab`, which is why the index lives in a bounded LRU.
5. `routing.ts:118`: file-tab keys need focus inside `#file-viewer`, so `renderViewer` focuses the viewer again.
6. `style.css:19`: `* { box-sizing: border-box }`, so the spacer uses `content-box`.
7. `style.css:32`: body `13px/1.4`, so `rowPx = Math.round(fontPx * 1.4)`.
8. `files.rs:117-129`: `TooLarge` returned before the NUL sniff. Paged mode sniffs first.
9. `tsconfig.json`: `lib: ["ES2020","DOM"]`. Do not use `for..of` over a `NodeList`, and do not use `Array.prototype.at`.
10. jsdom (probed):
    - `clientHeight` and `offsetWidth` are 0.
    - It stores `scrollTop`/`scrollLeft` unclamped.
    - It has no `ResizeObserver`, `CSS` or `Highlight`.
    - Its CSSOM parses `overflow-y: clip` and `overflow-anchor: none`.
11. Edge 155 probe: an element is clamped at 33,554,428 px, at DPR 1 and 3. Hence `MAX_SPACER_PX = 16_000_000`.
12. Impl doc edge case 32 is superseded. `currentLine` and `topLine` clamp when the file gets shorter.
13. The bar has no case toggle (`viewerFind.ts` bar = input and count), so `fs_search` has no `caseSensitive`.

**counterintuitive**
- **Height clamp.** Chromium clamps element height, so a full-height spacer alone loses every row past about 1.86 M lines (edge case 11).
- **Pixel anchor drift.** A pixel position is not a stable anchor in scaled mode. When `count` grows, the same `scrollTop` maps to a later line. `topLine` is the truth, and `scrollTop` follows it.
- **Echo scroll event.** Setting `scrollTop` fires an async scroll event. Without the `placedTop` guard, that echo rewrites `topLine` from a rounded pixel value, and the anchor drifts on each refresh.
- **`scrollLeft` order.** Set `scrollLeft` after the first paint: the painted rows give the scroll width.
- **`widest` is measured, not estimated.** It uses `offsetLeft + offsetWidth` of the text spans, read after the row build (one layout). A `ch` estimate is wrong for tabs and wide characters. Spans are flex items that do not grow, so their width is the content width. The window itself has `min-width: 100%`, so measuring it would feed back the body width.
- **`clip`, not `hidden`.** `overflow-y: clip` creates no scroll container, so the sticky gutter still sticks to the body. It also stops a scaled window from growing the scroll range. A JS clamp of `shownLast` needs the window top, which moves with every scroll in scaled mode, and it would drop overscan rows.
- **`overflow-anchor: none`.** Rows change under the viewport, so browser scroll anchoring would otherwise move `scrollTop` and fire scroll events that move the anchor.
- **Teardown trap.** `beforeEach(() => vi.spyOn(...))` with an arrow that returns the spy makes vitest call the spy as teardown. Use a braced body.
- **`reading` flag.** `readSeq` alone restarts a read slower than 2 s forever. The `reading` flag makes the poll, focus and click wait.
- **Stale index for page reads.** `fs_read_lines` reads through a stale index. Only `fs_open_paged` (from `readActive`) updates it, by append extension or by a rebuild.
- **Old pages on refresh.** A paged refresh shows the previous render's pages as placeholder text, so rows do not blank on every poll.
- **Clippy.** Rust needs `type IndexList` and `is_multiple_of`, or clippy `-D warnings` fails.
- **Cancel through an empty query.** An empty query is the cancel signal. `fs_search` bumps `SEARCH_GENERATION` before it looks at the query, so `fsSearch(root, rel, "", n)` stops the running scan at its next line or buffer.

**rejected alternative**
- `fs_close_paged(root, rel)` on tab close. It lost because tabs also vanish without `closeTab` (`appFiles.ts:153`), so a close call leaks. A bounded LRU of 8 needs no frontend wiring.

**acceptance**
- **Offline:**
  `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run && cd src-tauri && cargo test && rustfmt --edition 2021 --check src/files.rs && ! cargo clippy -- -D warnings 2>&1 | grep -E "src.(files|lib)\.rs"`
  - Expected:
    - tsc is silent.
    - vitest: 76 files, 949 tests, 0 failed.
    - cargo test: all `ok`; lib shows 375 passed.
    - rustfmt is silent.
    - grep is empty.
  - Plain `cargo clippy -- -D warnings` still fails on `flutter.rs:498`/`:604` (pre-existing).
- **Live:** the user runs this in their own terminal.
  1. In `gui`, run `npm run tauri dev`.
  2. In PowerShell:
     `mkdir $env:TEMP\fv-live; cd $env:TEMP\fv-live; 1..30000 | % { "line $_" } | Set-Content t30k.txt; $w=[IO.StreamWriter]::new("$PWD\big.log"); 1..2000000 | % { $w.WriteLine("$_ " + ("x"*99)) }; $w.Close()`
  3. Open the folder as the workspace.
  4. `t30k.txt`: Ctrl+F `line 29999` shows `1/1`, and the row is in view.
  5. Run `Add-Content t30k.txt appended`. Within about 2 s line 30001 shows, with no "Loading…", and the top line stays.
  6. Type in the find bar during step 5. The input keeps focus, and the bar is above the rows.
  7. Scroll right on a long line, then scroll down into short lines. `scrollLeft` stays, and the gutter stays sticky.
  8. `big.log` (paged mode):
     - Drag the scrollbar to the bottom. Line 2000000 shows, and the wheel does not scroll past it.
     - Repeat at real 150 % Windows scaling.
  9. Scroll `big.log` to the middle. Run `1..20 | % { Add-Content big.log "tail $_"; Start-Sleep 1 }`.
     - The top line does not move, and rows never go blank.
     - Each update is fast: an append extends the index.
  10. Type `1999999 ` in the find bar. It shows "Searching…", then a count, and Enter jumps to the line.
  11. Type `x`, then press Esc while it shows "Searching…". CPU use falls in Task Manager.
  12. Alt-Tab away, edit `t30k.txt`, Alt-Tab back. The new text shows.
  13. Click the active tab: no "Loading…" flash.
  14. In DevTools, `document.querySelectorAll('.fv-line').length` is under 150.

**smallest-change check**
- s1–s3: only the backend can stat, index and search a file without loading it. These steps reuse `confine`, `io_error`, `join_error`, `spawn_blocking` and `.manage`. Append extension reuses the one scan function with a start point.
- s4: one wrapper per command. The test pins the cross-language argument keys, a known trap.
- s5: CSS is the only way to get fixed rows, absolute placement and clipping.
- s6: one viewport fed by a 3-member `LineSource` serves both modes. The anchor and the width are 2 optional fields on the existing `TabView`.
- s7: find must leave the DOM. The bar UI and its helpers are reused. Cancel reuses `fs_search` with an empty query, so no new command.
- s8: freshness lives where `readSeq` and `content` live. Cancel on a diff-view hide reuses the existing `MutationObserver`.
- s9: the design spec contradicts the code without it.

---

## Steps

### step 1: drop the 2 MiB cap, add `ReadKind::Paged` and `fs_stat`

**files:** `gui/src-tauri/src/files.rs`, `gui/src-tauri/src/lib.rs`

**edit:**
- **a.** Replace `const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;` with:
  ```rust
  /// A file of this size or more opens in paged mode: the viewer reads its lines with `fs_read_lines`.
  /// The frontend keeps no copy of this value; it reacts to `ReadKind::Paged`.
  const PAGED_THRESHOLD_BYTES: u64 = 8 * 1024 * 1024;
  ```
- **b.** In `enum ReadKind`, change `    TooLarge,` to `    Paged,`.
- **c.** After `pub struct ReadResult {...}`, add:
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct FileStat {
      pub mtime_ms: u64,
      pub size: u64,
  }
  ```
- **d.** Replace the whole `fn read_text` (`files.rs:106-142`) with:
  ```rust
  /// The confined path and the metadata of a regular file.
  fn regular_file(root: &str, rel: &str) -> Result<(PathBuf, std::fs::Metadata), ApiError> {
      let path = confine(root, rel)?;
      let meta = std::fs::metadata(&path).map_err(io_error)?;
      // A FIFO open blocks on Unix; a folder or a submodule is not a file.
      if !meta.is_file() {
          return Err(api_error("not_a_file", format!("Not a regular file: {rel}")));
      }
      Ok((path, meta))
  }

  fn stat_of(meta: &std::fs::Metadata) -> FileStat {
      let mtime_ms = meta
          .modified()
          .ok()
          .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
          .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
      FileStat { mtime_ms, size: meta.len() }
  }

  fn read_text(root: &str, rel: &str) -> Result<ReadResult, ApiError> {
      let (path, meta) = regular_file(root, rel)?;
      let size = meta.len();
      let paged = size >= PAGED_THRESHOLD_BYTES;
      // Paged mode reads only the head for the binary check. The limit also bounds a file that grows during the read.
      let limit = if paged { BINARY_SNIFF_BYTES as u64 } else { PAGED_THRESHOLD_BYTES };
      let mut bytes = Vec::new();
      std::fs::File::open(&path)
          .map_err(io_error)?
          .take(limit)
          .read_to_end(&mut bytes)
          .map_err(io_error)?;
      let kind = if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
          ReadKind::Binary
      } else if paged {
          ReadKind::Paged
      } else {
          ReadKind::Text
      };
      let content = (kind == ReadKind::Text).then(|| String::from_utf8_lossy(&bytes).into_owned());
      Ok(ReadResult { kind, content, size })
  }

  fn stat_file(root: &str, rel: &str) -> Result<FileStat, ApiError> {
      regular_file(root, rel).map(|(_, meta)| stat_of(&meta))
  }
  ```
- **e.** After the `fs_read_text` command, add:
  ```rust
  #[tauri::command]
  pub async fn fs_stat(root: String, rel: String) -> Result<FileStat, ApiError> {
      tokio::task::spawn_blocking(move || stat_file(&root, &rel))
          .await
          .map_err(join_error)?
  }
  ```
- **f.** Tests:
  - Delete `read_text_over_max_is_too_large` and `read_text_exactly_max_is_text`.
  - In `serde_shapes_are_camel_case`, replace the `ReadKind::TooLarge` assert with:
    ```rust
    assert_eq!(serde_json::to_string(&ReadKind::Paged).unwrap(), "\"paged\"");
    assert_eq!(
        serde_json::to_value(FileStat { mtime_ms: 1, size: 2 }).unwrap(),
        serde_json::json!({ "mtimeMs": 1, "size": 2 })
    );
    ```
  - Add:
    ```rust
    #[test]
    fn read_text_under_the_paged_threshold_is_text() {
        let n = PAGED_THRESHOLD_BYTES as usize - 1; // over the old 2 MiB cap
        let r = read_bytes("under-paged", &vec![b'a'; n]).unwrap();
        assert_eq!(r.kind, ReadKind::Text);
        assert_eq!(r.content.map(|c| c.len()), Some(n));
    }

    #[test]
    fn read_text_at_the_paged_threshold_is_paged_without_content() {
        let r = read_bytes("paged", &vec![b'a'; PAGED_THRESHOLD_BYTES as usize]).unwrap();
        assert_eq!(r.kind, ReadKind::Paged);
        assert_eq!(r.content, None);
        assert_eq!(r.size, PAGED_THRESHOLD_BYTES);
    }

    #[test]
    fn read_text_paged_size_with_a_nul_is_binary() {
        let mut bytes = vec![b'a'; PAGED_THRESHOLD_BYTES as usize];
        bytes[10] = 0;
        assert_eq!(read_bytes("paged-binary", &bytes).unwrap().kind, ReadKind::Binary);
    }

    #[test]
    fn stat_reports_size_and_mtime_and_rejects_non_files() {
        let root = temp_dir("stat");
        std::fs::write(root.join("f.txt"), "hello").unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let st = stat_file(&s(&root), "f.txt").unwrap();
        assert_eq!(st.size, 5);
        assert!(st.mtime_ms > 0);
        assert_eq!(stat_file(&s(&root), "nope.txt").unwrap_err().code, "not_found");
        assert_eq!(stat_file(&s(&root), "sub").unwrap_err().code, "not_a_file");
    }

    #[test]
    fn stat_is_confined_to_the_root() {
        let (base, _) = root_with_outside("stat-dotdot");
        assert_eq!(stat_file(&s(&base), "../outside.txt").unwrap_err().code, "outside_root");
    }
    ```
- **g.** `lib.rs`: replace `            files::fs_list_files,` with `            files::fs_list_files,\n            files::fs_stat,`.
- Then run `rustfmt --edition 2021 src/files.rs`. Never rustfmt `lib.rs`.

**lines:** a 4, b 2, c 7, d ~37 removed + ~50 added, e 7, f ~15 removed + ~45 added, g 1.

**exec:** judgment. This is the first real-crate compile, and `rustfmt` reshapes the code.

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test --lib files::tests 2>&1 | grep "test result"` gives `test result: ok. 24 passed; 0 failed`.

### step 2: line index with append extension, `fs_open_paged`, `fs_read_lines`

**files:** `gui/src-tauri/src/files.rs`, `gui/src-tauri/src/lib.rs`

**edit:**
- **a.** Change `use std::io::Read;` to `use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};`. Add `use std::sync::{Arc, Mutex, PoisonError};`. In the test module, add `use std::io::Write;`.
- **b.** After `const BINARY_SNIFF_BYTES...`, add:
  ```rust
  /// The line index keeps the byte offset of every `INDEX_STEP`-th line.
  const INDEX_STEP: u64 = 256;
  /// Line indexes kept in memory, most recently used first. A bounded map needs no close call from the viewer.
  const MAX_INDEXES: usize = 8;
  const MAX_READ_LINES: u64 = 1000;
  /// Paged mode cuts a longer line here, so one giant line cannot fill memory (a 500-line page stays under 32 MiB).
  const MAX_LINE_BYTES: u64 = 64 * 1024;
  const IO_BUF_BYTES: usize = 64 * 1024;
  ```
- **c.** After `FileStat`, add:
  ```rust
  /// The byte offset of every `INDEX_STEP`-th line of one file, for the file's `stat`.
  #[derive(Debug)]
  struct LineIndex {
      stat: FileStat,
      line_count: u64,
      offsets: Vec<u64>,
  }

  type IndexList = Vec<(PathBuf, Arc<LineIndex>)>;

  /// Tauri state: the line indexes of paged files, keyed by canonical path, most recently used first.
  #[derive(Default, Clone)]
  pub struct PagedIndexes(Arc<Mutex<IndexList>>);
  ```
- **d.** After `stat_file`, add:
  ```rust
  /// Counts lines from the last offset in `offsets` (a line start after `newlines` line ends) to the end of the file,
  /// and adds the offset of every `INDEX_STEP`-th line. A full build starts with `vec![0]` and 0.
  fn scan_index(path: &Path, stat: FileStat, mut offsets: Vec<u64>, mut newlines: u64) -> Result<LineIndex, ApiError> {
      let mut pos = offsets.last().copied().unwrap_or(0);
      let mut file = std::fs::File::open(path).map_err(io_error)?;
      file.seek(SeekFrom::Start(pos)).map_err(io_error)?;
      let mut buf = vec![0u8; IO_BUF_BYTES];
      let mut last = b'\n';
      loop {
          let n = file.read(&mut buf).map_err(io_error)?;
          if n == 0 {
              break;
          }
          for (i, &b) in buf[..n].iter().enumerate() {
              if b == b'\n' {
                  newlines += 1;
                  if newlines.is_multiple_of(INDEX_STEP) {
                      offsets.push(pos + i as u64 + 1);
                  }
              }
          }
          last = buf[n - 1];
          pos += n as u64;
      }
      // A last line without `\n` counts; a final `\n` adds no empty line (the text-mode split in fileViewer.ts).
      let line_count = (newlines + u64::from(last != b'\n')).max(1);
      Ok(LineIndex { stat, line_count, offsets })
  }

  /// True when `offset` is still a line start: offset 0, or a `\n` just before it. An append keeps this; most rewrites do not.
  fn line_start_at(path: &Path, offset: u64) -> bool {
      if offset == 0 {
          return true;
      }
      let mut byte = [0u8; 1];
      std::fs::File::open(path)
          .and_then(|mut file| {
              file.seek(SeekFrom::Start(offset - 1))?;
              file.read_exact(&mut byte)
          })
          .is_ok_and(|()| byte[0] == b'\n')
  }

  /// The index of `path`. With `fresh`, an entry for another mtime or size is updated: extended from its last offset
  /// when the file grew and that offset is still a line start (an append), else built again. Without `fresh`, a stale
  /// entry serves `fs_read_lines`, so a page read never scans the whole file.
  fn index_for(
      indexes: &PagedIndexes,
      path: &Path,
      meta: &std::fs::Metadata,
      fresh: bool,
  ) -> Result<Arc<LineIndex>, ApiError> {
      let stat = stat_of(meta);
      let cached = {
          let mut list = indexes.0.lock().unwrap_or_else(PoisonError::into_inner);
          match list.iter().position(|(p, _)| p == path) {
              Some(i) => {
                  let entry = list.remove(i);
                  let index = Arc::clone(&entry.1);
                  list.insert(0, entry);
                  if !fresh || index.stat == stat {
                      return Ok(index);
                  }
                  Some(index)
              }
              None => None,
          }
      };
      // Built without the lock: a scan of a large file takes seconds.
      let grown = cached.filter(|old| {
          old.stat.size < stat.size && line_start_at(path, old.offsets.last().copied().unwrap_or(0))
      });
      let index = Arc::new(match grown {
          Some(old) => scan_index(path, stat, old.offsets.clone(), (old.offsets.len() as u64 - 1) * INDEX_STEP)?,
          None => scan_index(path, stat, vec![0], 0)?,
      });
      let mut list = indexes.0.lock().unwrap_or_else(PoisonError::into_inner);
      list.retain(|(p, _)| p != path);
      list.insert(0, (path.to_path_buf(), Arc::clone(&index)));
      list.truncate(MAX_INDEXES);
      Ok(index)
  }

  fn open_paged(indexes: &PagedIndexes, root: &str, rel: &str) -> Result<u64, ApiError> {
      let (path, meta) = regular_file(root, rel)?;
      Ok(index_for(indexes, &path, &meta, true)?.line_count)
  }

  /// Skips the rest of a cut line, one buffer at a time. Returns early when `stop` says so (a newer search).
  fn skip_rest(reader: &mut impl BufRead, stop: &dyn Fn() -> bool) -> std::io::Result<()> {
      loop {
          let (newline, len) = {
              let chunk = reader.fill_buf()?;
              (chunk.iter().position(|&b| b == b'\n'), chunk.len())
          };
          if len == 0 {
              return Ok(());
          }
          if let Some(i) = newline {
              reader.consume(i + 1);
              return Ok(());
          }
          reader.consume(len);
          if stop() {
              return Ok(());
          }
      }
  }

  /// Reads one line into `buf` without its `\n` or `\r\n`, cut at MAX_LINE_BYTES. Returns false at the end of the file.
  fn next_line(reader: &mut impl BufRead, buf: &mut Vec<u8>, stop: &dyn Fn() -> bool) -> std::io::Result<bool> {
      buf.clear();
      let n = reader.by_ref().take(MAX_LINE_BYTES).read_until(b'\n', buf)?;
      if n == 0 {
          return Ok(false);
      }
      if buf.last() == Some(&b'\n') {
          buf.pop();
      } else if n as u64 == MAX_LINE_BYTES {
          skip_rest(reader, stop)?;
      }
      if buf.last() == Some(&b'\r') {
          buf.pop();
      }
      Ok(true)
  }

  fn read_lines(indexes: &PagedIndexes, root: &str, rel: &str, start: u64, count: u64) -> Result<Vec<String>, ApiError> {
      let (path, meta) = regular_file(root, rel)?;
      let index = index_for(indexes, &path, &meta, false)?;
      let mut lines = Vec::new();
      let Some(&offset) = index.offsets.get((start / INDEX_STEP) as usize) else {
          return Ok(lines); // past the end
      };
      let mut reader = BufReader::with_capacity(IO_BUF_BYTES, std::fs::File::open(&path).map_err(io_error)?);
      reader.seek(SeekFrom::Start(offset)).map_err(io_error)?;
      for _ in 0..start % INDEX_STEP {
          reader.skip_until(b'\n').map_err(io_error)?;
      }
      let mut buf = Vec::new();
      while (lines.len() as u64) < count.min(MAX_READ_LINES) && next_line(&mut reader, &mut buf, &|| false).map_err(io_error)? {
          lines.push(String::from_utf8_lossy(&buf).into_owned());
      }
      Ok(lines)
  }
  ```
- **e.** After `fs_stat`, add the commands:
  ```rust
  #[tauri::command]
  pub async fn fs_open_paged(indexes: tauri::State<'_, PagedIndexes>, root: String, rel: String) -> Result<u64, ApiError> {
      let indexes = indexes.inner().clone(); // an Arc: the blocking task owns it, and no lock is held across .await
      tokio::task::spawn_blocking(move || open_paged(&indexes, &root, &rel))
          .await
          .map_err(join_error)?
  }

  #[tauri::command]
  pub async fn fs_read_lines(
      indexes: tauri::State<'_, PagedIndexes>,
      root: String,
      rel: String,
      start: u64,
      count: u64,
  ) -> Result<Vec<String>, ApiError> {
      let indexes = indexes.inner().clone();
      tokio::task::spawn_blocking(move || read_lines(&indexes, &root, &rel, start, count))
          .await
          .map_err(join_error)?
  }
  ```
- **f.** Tests to add:
  ```rust
  fn paged_file(name: &str, bytes: &[u8]) -> PathBuf {
      let root = temp_dir(name);
      std::fs::write(root.join("f"), bytes).unwrap();
      root
  }

  #[test]
  fn index_counts_lines_like_the_text_mode_split() {
      for (i, (text, n)) in [("a\nb\n", 2), ("a\nb", 2), ("a\r\nb\r\n", 2), ("\n", 1)].into_iter().enumerate() {
          let root = paged_file(&format!("index-count-{i}"), text.as_bytes());
          assert_eq!(open_paged(&PagedIndexes::default(), &s(&root), "f").unwrap(), n, "{text:?}");
      }
  }

  #[test]
  fn read_lines_seeks_through_the_index_and_strips_line_ends() {
      let text: String = (0..1000).map(|i| format!("line {i}\r\n")).collect();
      let root = paged_file("read-lines", text.as_bytes());
      let ix = PagedIndexes::default();
      let read = |start, count| read_lines(&ix, &s(&root), "f", start, count).unwrap();
      assert_eq!(read(300, 3), ["line 300", "line 301", "line 302"]);
      assert_eq!(read(998, 10), ["line 998", "line 999"]);
      assert!(read(1000, 10).is_empty());
      assert!(read(5000, 10).is_empty());
      assert_eq!(read(0, 5000).len() as u64, MAX_READ_LINES);
  }

  #[test]
  fn read_lines_cuts_a_giant_line_and_decodes_lossy() {
      let mut bytes = vec![b'a'; MAX_LINE_BYTES as usize + 10];
      bytes.extend_from_slice(b"\nf\xffo\n");
      let root = paged_file("long-line", &bytes);
      let lines = read_lines(&PagedIndexes::default(), &s(&root), "f", 0, 10).unwrap();
      assert_eq!(lines.len(), 2);
      assert_eq!(lines[0].len() as u64, MAX_LINE_BYTES);
      assert_eq!(lines[1], "f\u{fffd}o");
  }

  #[test]
  fn index_is_reused_until_the_file_changes_and_the_map_stays_bounded() {
      let root = paged_file("index-lru", b"a\n");
      let ix = PagedIndexes::default();
      let (path, meta) = regular_file(&s(&root), "f").unwrap();
      let first = index_for(&ix, &path, &meta, true).unwrap();
      assert!(Arc::ptr_eq(&first, &index_for(&ix, &path, &meta, true).unwrap()));
      std::fs::write(root.join("f"), "a\nb\nc\n").unwrap(); // a new size
      let (path, meta) = regular_file(&s(&root), "f").unwrap();
      assert!(Arc::ptr_eq(&first, &index_for(&ix, &path, &meta, false).unwrap()));
      assert_eq!(index_for(&ix, &path, &meta, true).unwrap().line_count, 3);
      for i in 0..MAX_INDEXES + 2 {
          std::fs::write(root.join(format!("g{i}")), "x").unwrap();
          let (p, m) = regular_file(&s(&root), &format!("g{i}")).unwrap();
          index_for(&ix, &p, &m, true).unwrap();
      }
      assert_eq!(ix.0.lock().unwrap().len(), MAX_INDEXES);
  }

  #[test]
  fn index_extends_an_append_to_what_a_full_build_gives() {
      let head = (0..1000).map(|i| format!("line {i}\n")).collect::<String>() + "partial";
      let root = paged_file("index-append", head.as_bytes());
      let ix = PagedIndexes::default();
      let (path, meta) = regular_file(&s(&root), "f").unwrap();
      let old = index_for(&ix, &path, &meta, true).unwrap();
      std::fs::OpenOptions::new().append(true).open(root.join("f")).unwrap().write_all(b" tail\nmore\n").unwrap();
      let (path, meta) = regular_file(&s(&root), "f").unwrap();
      let extended = scan_index(&path, stat_of(&meta), old.offsets.clone(), (old.offsets.len() as u64 - 1) * INDEX_STEP).unwrap();
      let full = scan_index(&path, stat_of(&meta), vec![0], 0).unwrap();
      assert_eq!((extended.line_count, &extended.offsets), (full.line_count, &full.offsets));
      assert_eq!(index_for(&ix, &path, &meta, true).unwrap().line_count, 1002);
      assert!(line_start_at(&path, old.offsets[1]));
      assert!(!line_start_at(&path, 3));
  }

  #[test]
  fn skip_rest_stops_between_buffers_when_asked() {
      let data = [vec![b'a'; 100], b"\nb\n".to_vec()].concat();
      let mut reader = BufReader::with_capacity(16, data.as_slice());
      skip_rest(&mut reader, &|| true).unwrap();
      let mut rest = Vec::new();
      reader.read_to_end(&mut rest).unwrap();
      assert_eq!(rest.len(), data.len() - 16); // one buffer, then it stopped
      let mut reader = BufReader::with_capacity(16, data.as_slice());
      skip_rest(&mut reader, &|| false).unwrap();
      let mut buf = Vec::new();
      assert!(next_line(&mut reader, &mut buf, &|| false).unwrap());
      assert_eq!(buf, b"b");
  }
  ```
- **g.** `lib.rs`:
  - Replace `        .manage(android::ScreenshotSlot::default())` with that line followed by `        .manage(files::PagedIndexes::default())`.
  - Replace `            files::fs_stat,` with `            files::fs_stat,\n            files::fs_open_paged,\n            files::fs_read_lines,`.
- Then run `rustfmt --edition 2021 src/files.rs`.

**lines:** a 3, b 8, c 13, d ~150, e 22, f ~85, g 3.

**exec:** judgment. New state type, Tauri `State`, the first real compile of the index.

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test --lib files::tests 2>&1 | grep "test result"` gives `test result: ok. 30 passed; 0 failed`.

### step 3: `fs_search`, newest search wins, empty query cancels

**files:** `gui/src-tauri/src/files.rs`, `gui/src-tauri/src/lib.rs`

**edit:**
- **a.** Add `use std::sync::atomic::{AtomicU64, Ordering};`. The test module keeps its own identical import; it is warning-free, checked.
- **b.** After `PagedIndexes`, add:
  ```rust
  /// `col` counts UTF-16 code units, the unit of a JS string index and a DOM range offset.
  #[derive(Debug, Clone, PartialEq, Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct SearchMatch {
      pub line: u64,
      pub col: u64,
  }

  #[derive(Debug, Clone, PartialEq, Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct SearchResult {
      pub matches: Vec<SearchMatch>,
      pub truncated: bool,
  }

  /// Each `fs_search` call bumps it, an empty query too. An older scan sees the change and stops: one find bar searches at a time.
  static SEARCH_GENERATION: AtomicU64 = AtomicU64::new(0);
  ```
- **c.** After `read_lines`, add:
  ```rust
  /// Case-insensitive, non-overlapping matches of `query` in each line, like `findMatches` in viewerFind.ts. Stops with
  /// `cancelled` when `cancel` no longer holds `generation`: checked on each line, and on each buffer of a cut line.
  fn search_file(
      path: &Path,
      query: &str,
      max_matches: usize,
      cancel: &AtomicU64,
      generation: u64,
  ) -> Result<SearchResult, ApiError> {
      let needle = query.to_lowercase();
      let mut matches = Vec::new();
      if needle.is_empty() {
          return Ok(SearchResult { matches, truncated: false });
      }
      let stopped = || cancel.load(Ordering::Relaxed) != generation;
      let mut reader = BufReader::with_capacity(IO_BUF_BYTES, std::fs::File::open(path).map_err(io_error)?);
      let mut buf = Vec::new();
      let mut line = 0u64;
      while next_line(&mut reader, &mut buf, &stopped).map_err(io_error)? {
          if stopped() {
              return Err(api_error("cancelled", "A newer search replaced this one"));
          }
          let hay = String::from_utf8_lossy(&buf).to_lowercase();
          let (mut col, mut prev) = (0u64, 0usize);
          for (at, _) in hay.match_indices(needle.as_str()) {
              if matches.len() == max_matches {
                  return Ok(SearchResult { matches, truncated: true });
              }
              col += hay[prev..at].encode_utf16().count() as u64;
              prev = at;
              matches.push(SearchMatch { line, col });
          }
          line += 1;
      }
      Ok(SearchResult { matches, truncated: false })
  }
  ```
- **d.** Command:
  ```rust
  #[tauri::command]
  pub async fn fs_search(root: String, rel: String, query: String, max_matches: usize) -> Result<SearchResult, ApiError> {
      // Before the query check: an empty query is how the viewer stops a running search.
      let generation = SEARCH_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
      tokio::task::spawn_blocking(move || {
          let (path, _) = regular_file(&root, &rel)?;
          search_file(&path, &query, max_matches, &SEARCH_GENERATION, generation)
      })
      .await
      .map_err(join_error)?
  }
  ```
- **e.** Tests:
  ```rust
  fn search_bytes(name: &str, bytes: &[u8], query: &str, max: usize) -> SearchResult {
      let root = paged_file(name, bytes);
      search_file(&root.join("f"), query, max, &AtomicU64::new(0), 0).unwrap()
  }

  #[test]
  fn search_is_case_insensitive_without_overlap_with_utf16_columns() {
      let r = search_bytes("search", "Foo foo\r\nbar\n\u{e9} FOO\n".as_bytes(), "foo", 100);
      let found: Vec<(u64, u64)> = r.matches.iter().map(|m| (m.line, m.col)).collect();
      assert_eq!(found, [(0, 0), (0, 4), (2, 2)]); // the 2-byte e-acute is 1 UTF-16 unit
      assert!(!r.truncated);
      assert_eq!(search_bytes("search-overlap", b"aaaa", "aa", 100).matches.len(), 2);
      assert!(search_bytes("search-empty", b"abc", "", 100).matches.is_empty());
  }

  #[test]
  fn search_stops_at_max_and_when_a_newer_search_starts() {
      let r = search_bytes("search-max", b"x\nx\nx\n", "x", 2);
      assert_eq!(r.matches.len(), 2);
      assert!(r.truncated);
      let root = paged_file("search-cancel", b"x");
      let newer = AtomicU64::new(1);
      assert_eq!(search_file(&root.join("f"), "x", 10, &newer, 0).unwrap_err().code, "cancelled");
  }
  ```
- **f.** `lib.rs`: replace `            files::fs_read_lines,` with `            files::fs_read_lines,\n            files::fs_search,`.
- Then run `rustfmt --edition 2021 src/files.rs`.

**lines:** a 1, b 18, c 38, d 12, e 22, f 1.

**exec:** judgment. Cancellation semantics, plus a real-crate compile.

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test --lib files::tests 2>&1 | grep "test result" && rustfmt --edition 2021 --check src/files.rs && ! cargo clippy -- -D warnings 2>&1 | grep -E "src.(files|lib)\.rs"` gives `test result: ok. 32 passed; 0 failed` and nothing else.

### step 4: TS wrappers and their argument keys

**files:** `gui/src/files/filesApi.ts` (clean in git), `gui/tests/unit/files/filesApi.test.ts` (new)

**edit (filesApi.ts):** the whole new content.
```ts
// File viewer spec §3: the TypeScript side of `src-tauri/src/files.rs`. Each
// wrapper is one `invoke` and rejects with the backend's `{ code, message }`
// `ApiError`. Error codes: `invalid_root`, `outside_root`, `not_found`,
// `not_a_file`, `io_error`, `fs_failed`, `cancelled` (`fs_search` only).

import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface ReadResult {
  /** `paged`: the file has 8 MiB or more. Read its lines with `fsOpenPaged` and `fsReadLines`. */
  kind: "text" | "binary" | "paged";
  /** Set only for `text`. */
  content: string | null;
  size: number;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
}

/** `col` counts UTF-16 code units, the same unit as a JS string index. */
export interface SearchMatch {
  line: number;
  col: number;
}

export interface SearchResult {
  matches: SearchMatch[];
  /** The backend stopped at `maxMatches`. */
  truncated: boolean;
}

/** Named `FileListing`: `FileList` is a DOM global. */
export interface FileListing {
  files: string[];
  truncated: boolean;
}

export function fsListDir(root: string, rel: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("fs_list_dir", { root, rel });
}

export function fsReadText(root: string, rel: string): Promise<ReadResult> {
  return invoke<ReadResult>("fs_read_text", { root, rel });
}

export function fsStat(root: string, rel: string): Promise<FileStat> {
  return invoke<FileStat>("fs_stat", { root, rel });
}

/** Indexes the lines of a paged file (again, when it changed). Returns the line count, at least 1. */
export function fsOpenPaged(root: string, rel: string): Promise<number> {
  return invoke<number>("fs_open_paged", { root, rel });
}

/** At most 1000 lines from `start`, each without its line end and cut at 64 KiB. */
export function fsReadLines(root: string, rel: string, start: number, count: number): Promise<string[]> {
  return invoke<string[]>("fs_read_lines", { root, rel, start, count });
}

/** Case-insensitive. An empty query stops a search that runs and returns no matches. */
export function fsSearch(root: string, rel: string, query: string, maxMatches: number): Promise<SearchResult> {
  return invoke<SearchResult>("fs_search", { root, rel, query, maxMatches });
}

export function fsListFiles(root: string): Promise<FileListing> {
  return invoke<FileListing>("fs_list_files", { root });
}
```

**edit (filesApi.test.ts):** new file.
```ts
import { describe, expect, it, vi } from "vitest";

// Tauri maps these camelCase keys to the snake_case parameters of the Rust commands (files.rs).
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { fsOpenPaged, fsReadLines, fsSearch, fsStat } from "../../../src/files/filesApi";

describe("filesApi", () => {
  it("sends the command names and the argument keys of the Rust commands", async () => {
    invoke.mockResolvedValue(null);
    await fsStat("/r", "a");
    await fsOpenPaged("/r", "a");
    await fsReadLines("/r", "a", 500, 500);
    await fsSearch("/r", "a", "q", 10_000);
    expect(invoke.mock.calls).toEqual([
      ["fs_stat", { root: "/r", rel: "a" }],
      ["fs_open_paged", { root: "/r", rel: "a" }],
      ["fs_read_lines", { root: "/r", rel: "a", start: 500, count: 500 }],
      ["fs_search", { root: "/r", rel: "a", query: "q", maxMatches: 10_000 }],
    ]);
  });
});
```

**lines:** filesApi ~45 added, 2 removed; test 23.

**exec:** judgment. New test file (content is exact; validated in scratch).

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/files/filesApi.test.ts 2>&1 | grep "Tests "` gives `1 passed`.

### step 5: CSS for virtual rows

**files:** `gui/src/style.css`

**edit:** old text (`style.css:3414-3423`):
```css
.fv-lines {
  width: max-content;
  min-width: 100%;
  padding: 4px 0;
}

.fv-line {
  display: flex;
  white-space: pre;
}
```
new text:
```css
/* The spacer of the virtual rows (fileViewer.ts renderRows): JS sets its height and, as wide rows paint, its width. */
.fv-lines {
  position: relative;
  box-sizing: content-box; /* the inline height is the rows only; the padding adds to it */
  overflow-y: clip; /* a scaled window can reach past the spacer; clip, not hidden: no scroll container, so the gutter stays sticky */
  overflow-anchor: none; /* rows change under the viewport; browser scroll anchoring must not move scrollTop */
  width: max-content;
  min-width: 100%;
  padding: 4px 0;
}

/* The rendered rows. JS sets `top`; the margin matches the top padding of the spacer. */
.fv-window {
  position: absolute;
  left: 0;
  margin-top: 4px;
  width: max-content;
  min-width: 100%;
}

/* One fixed whole-pixel row height (--fv-row), so the row positions match the spacer. */
.fv-line {
  display: flex;
  height: var(--fv-row);
  line-height: var(--fv-row);
  white-space: pre;
}
```

**lines:** 10 removed, 27 added.

**exec:** mechanical. Exact old and new text.

**verify:** this parses the real stylesheet with the jsdom CSSOM:
`cd /c/Users/Reinaldo/Backend/herdr/gui && node -e 'const {JSDOM,VirtualConsole}=require("jsdom");const css=require("fs").readFileSync("src/style.css","utf8");const d=new JSDOM("<style>"+css+"</style>",{virtualConsole:new VirtualConsole()}).window.document;const r={};for(const x of d.styleSheets[0].cssRules)if(x.selectorText)r[x.selectorText]=x.style;const g=(s,p)=>r[s].getPropertyValue(p);console.log([g(".fv-lines","overflow-y"),g(".fv-lines","box-sizing"),g(".fv-lines","overflow-anchor"),g(".fv-window","position"),g(".fv-line","height")].join(" "))'`
gives `clip content-box none absolute var(--fv-row)`.

### step 6: virtual viewport with a line anchor, two line sources, viewer handle

**files:** `gui/src/ui/fileViewer.ts`, `gui/tests/unit/ui/fileViewer.test.ts`

**edit (fileViewer.ts):** keep lines 1-5 and the block from `export interface TabState` through the end of `renderFileTabs`, with one edit inside it: in `viewOf`, change `view = { scrollTop: 0, currentLine: null };` to `view = { topLine: 0, currentLine: null };`.

**Region A.** Replace `fileViewer.ts:6-23` (the `languageFor` import through the end of `interface TabView`) with:
```ts
import type { SearchResult } from "../files/filesApi";
import { languageFor, tokenizeLine, type Language, type LineState } from "../files/highlight";
import { FONT_STACK } from "../render/renderer";
import { absolutePath, extLabel } from "./fileTree";

/** Rows rendered above and below the viewport. */
const OVERSCAN = 20;
/** Text mode stores the tokenizer state of every CHECKPOINT_LINES-th line, so a jump tokenizes fewer lines than that. */
const CHECKPOINT_LINES = 200;
/** Paged mode fetches aligned pages of PAGE_LINES lines and keeps the MAX_PAGES most recently used pages. */
const PAGE_LINES = 500;
const MAX_PAGES = 8;
/** Edge 155 (the WebView2 engine) clamps an element at 33,554,428 px. A taller file maps its scroll range to its lines in proportion. */
const MAX_SPACER_PX = 16_000_000;
/** The body font is `13px/1.4` (style.css). A row is that height in whole pixels, so the rows do not drift from the spacer. */
const LINE_HEIGHT = 1.4;

/** Paged mode (8 MiB and more): the lines stay on disk. `appFiles.ts` binds these functions to the backend commands. */
export interface PagedFile {
  lineCount: number;
  readLines(start: number, count: number): Promise<string[]>;
  search(query: string): Promise<SearchResult>;
}

export type ViewerContent =
  | { kind: "loading" }
  | { kind: "text"; text: string }
  | { kind: "paged"; file: PagedFile }
  | { kind: "binary" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export interface TabView {
  /** The line at the viewport top, with its fraction. A refresh that changes the line count keeps this line at the top. */
  topLine: number;
  /** Unset until the first scroll. */
  scrollLeft?: number;
  /** The widest row this tab painted, in px. The scroll width never shrinks under `scrollLeft`. */
  widest?: number;
  currentLine: number | null;
}

/** The lines of the last text or paged render, for find in the file (viewerFind.ts). */
export interface ViewerText {
  /** All lines in text mode; null in paged mode. */
  lines: readonly string[] | null;
  /** The backend search in paged mode; null in text mode. */
  search: ((query: string) => Promise<SearchResult>) | null;
  /** Puts `line` in the middle of the viewport and renders its rows. */
  scrollToLine(line: number): void;
}

let shownText: ViewerText | null = null;
let afterRows: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
// Paged mode: the pages of the last render. A refresh of the same file shows them while it fetches the pages again.
let lastPages: { key: string; pages: Map<number, string[] | null> } | null = null;

export function viewerText(): ViewerText | null {
  return shownText;
}

/** `fn` runs after each change of the rendered rows; null removes it. */
export function onViewerRows(fn: (() => void) | null): void {
  afterRows = fn;
}
```

**Region B.** Replace everything from `function renderLines(` (`fileViewer.ts:140`) to the end of the file with:
```ts
/** The lines of one render. The viewport reads only this interface, in text mode and in paged mode. */
interface LineSource {
  readonly count: number;
  /** Line `i`, or null while its page loads. */
  line(i: number): string | null;
  /** The tokenizer state at the start of line `i`. */
  stateAt(i: number): LineState;
  /** The viewport sets it; a paged source calls it when a page arrives. */
  onLoad?: () => void;
}

function textSource(text: string, lang: Language | null): LineSource & { lines: string[] } {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const checkpoints: LineState[] = [null]; // checkpoints[k]: the state at the start of line k * CHECKPOINT_LINES
  return {
    lines,
    count: lines.length,
    line: (i) => lines[i],
    stateAt: (i) => {
      const k = Math.min(Math.floor(i / CHECKPOINT_LINES), checkpoints.length - 1);
      let state = checkpoints[k];
      for (let j = k * CHECKPOINT_LINES; j < i; j++) {
        state = tokenizeLine(lines[j], lang, state).state;
        if ((j + 1) % CHECKPOINT_LINES === 0) checkpoints.push(state);
      }
      return state;
    },
  };
}

// shortcut: each page tokenizes from a null state, so a block comment that opens above a page colours it wrong; carry the state across pages if users report it.
function pagedSource(
  file: PagedFile,
  lang: Language | null,
  pages: Map<number, string[] | null>, // null while the page loads; Map order: least recently used first
  stale: Map<number, string[] | null> | undefined,
): LineSource {
  const page = (p: number): string[] | null => {
    const lines = pages.get(p);
    pages.delete(p);
    pages.set(p, lines ?? null);
    if (lines !== undefined) return lines;
    for (const old of pages.keys()) if (pages.size > MAX_PAGES) pages.delete(old);
    file.readLines(p * PAGE_LINES, PAGE_LINES).then(
      (got) => {
        if (pages.get(p) !== null) return; // dropped from the cache while it loaded
        pages.set(p, got);
        source.onLoad?.();
      },
      () => pages.delete(p), // the next paint asks again
    );
    return null;
  };
  const source: LineSource = {
    count: file.lineCount,
    line: (i) => {
      const p = Math.floor(i / PAGE_LINES);
      const lines = page(p) ?? stale?.get(p) ?? null;
      return lines === null ? null : (lines[i % PAGE_LINES] ?? "");
    },
    stateAt: (i) => {
      const p = Math.floor(i / PAGE_LINES);
      const lines = page(p) ?? stale?.get(p) ?? null;
      let state: LineState = null;
      if (lines !== null) for (let j = 0; j < i % PAGE_LINES; j++) state = tokenizeLine(lines[j] ?? "", lang, state).state;
      return state;
    },
  };
  return source;
}

interface Rows {
  /** Sets scrollTop from `view.topLine` and renders the rows. */
  place(): void;
  scrollToLine(line: number): void;
}

/**
 * Virtual rows: a spacer with the height of all lines, and a window that holds only the rows near the viewport.
 * All rows have one height and do not wrap. Above MAX_SPACER_PX, the scroll range maps to the lines in proportion.
 * `view.topLine` (the line at the viewport top) is the truth for the position; scrollTop follows it, so a refresh
 * that changes the line count keeps the same line at the top.
 */
function renderRows(body: HTMLElement, source: LineSource, lang: Language | null, view: TabView, rowPx: number): Rows {
  const count = source.count;
  if (view.currentLine !== null && view.currentLine >= count) view.currentLine = count - 1; // a refresh made the file shorter
  const spacerPx = Math.min(count * rowPx, MAX_SPACER_PX);
  const lines = el("div", "fv-lines");
  lines.style.setProperty("--fv-gutter", `${String(count).length + 1}ch`);
  lines.style.setProperty("--fv-row", `${rowPx}px`);
  lines.style.height = `${spacerPx}px`;
  if (view.widest) lines.style.width = `${view.widest}px`;
  const win = el("div", "fv-window");
  lines.appendChild(win);
  let shownFirst = 0;
  let shownLast = -1; // nothing rendered yet
  let placedTop = -1; // the scrollTop that place() set: its scroll event must not move the anchor
  /** The top line at the end of the scroll range. */
  const lastTop = (): number => Math.max(0, count - body.clientHeight / rowPx);
  const maxScroll = (): number => Math.max(1, spacerPx - body.clientHeight);
  const paint = (force = false): void => {
    const topExact = Math.min(view.topLine, lastTop());
    const scroll = Math.min(body.scrollTop, maxScroll());
    const top = Math.min(count - 1, Math.floor(topExact));
    const bottom = Math.min(count, Math.ceil(topExact + body.clientHeight / rowPx));
    const rebuild = force || top < shownFirst || bottom > shownLast;
    if (rebuild) {
      shownFirst = Math.max(0, top - OVERSCAN);
      shownLast = Math.min(count, bottom + OVERSCAN);
      win.textContent = "";
      const texts: HTMLElement[] = [];
      let state = source.stateAt(shownFirst);
      for (let i = shownFirst; i < shownLast; i++) {
        const row = el("div", i === view.currentLine ? "fv-line is-current" : "fv-line");
        row.dataset.line = String(i);
        row.appendChild(el("span", "fv-line__no", String(i + 1)));
        const textEl = el("span", "fv-line__text");
        const text = source.line(i);
        if (text !== null) {
          // null: a placeholder row while its page loads
          const result = tokenizeLine(text, lang, state);
          state = result.state;
          for (const token of result.tokens) {
            if (token.kind === "plain") textEl.appendChild(document.createTextNode(token.text));
            else textEl.appendChild(el("span", `tok-${token.kind}`, token.text));
          }
        }
        row.appendChild(textEl);
        win.appendChild(row);
        texts.push(textEl);
      }
      // The scroll width only grows: short rows near the viewport must not clamp scrollLeft. One layout, after the build.
      const natural = Math.max(0, ...texts.map((t) => t.offsetLeft + t.offsetWidth));
      if (natural > (view.widest ?? 0)) {
        view.widest = natural;
        lines.style.width = `${natural}px`;
      }
    }
    win.style.top = `${scroll - (topExact - shownFirst) * rowPx}px`;
    if (rebuild) afterRows?.();
  };
  const place = (): void => {
    view.topLine = Math.min(view.topLine, lastTop()); // the file got shorter, or the viewport taller
    const span = lastTop();
    body.scrollTop = span > 0 ? (view.topLine / span) * maxScroll() : 0;
    placedTop = body.scrollTop;
    paint();
  };
  source.onLoad = () => paint(true);
  body.addEventListener("scroll", () => {
    if (body.scrollTop !== placedTop) {
      // A user scroll: the anchor follows the scroll position. Without scaling, this is scrollTop / rowPx.
      view.topLine = (Math.min(body.scrollTop, maxScroll()) / maxScroll()) * lastTop();
      placedTop = -1;
    }
    view.scrollLeft = body.scrollLeft;
    paint();
  });
  lines.addEventListener("click", (event) => {
    const line = (event.target as Element | null)?.closest<HTMLElement>(".fv-line");
    if (!line) return;
    lines.querySelector(".fv-line.is-current")?.classList.remove("is-current");
    line.classList.add("is-current");
    view.currentLine = Number(line.dataset.line);
  });
  body.appendChild(lines);
  resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
  resizeObserver?.observe(body);
  return {
    place,
    scrollToLine: (line) => {
      view.topLine = Math.max(0, line - (body.clientHeight / rowPx - 1) / 2);
      place();
    },
  };
}

export function renderFileViewer(
  rootEl: HTMLElement,
  model: FileViewerModel,
  fontSizePx: number,
): void {
  // A refresh keeps the find bar (viewerFind.ts) in place, so its input keeps focus. All else is built again.
  for (const child of Array.from(rootEl.children)) if (!child.classList.contains("fv-find-bar")) child.remove();
  shownText = null;
  resizeObserver?.disconnect();
  const previous = lastPages;
  lastPages = null;
  const { content, view, active } = model;
  const rootName = model.root.split(/[/\\]/).filter(Boolean).pop() ?? model.root;
  const lang = languageFor(active === null ? "" : fileName(active));
  const rowPx = Math.round(fontSizePx * LINE_HEIGHT);

  const body = el("div", "fv-body");
  body.style.fontFamily = FONT_STACK;
  body.style.fontSize = `${fontSizePx}px`;
  let rows: Rows | null = null;
  switch (content.kind) {
    case "loading":
      body.appendChild(el("div", "fv-notice", "Loading…"));
      break;
    case "binary":
      body.appendChild(el("div", "fv-notice", "Binary file, not shown"));
      break;
    case "missing":
      body.appendChild(el("div", "fv-notice", "File not found. It was moved or deleted."));
      break;
    case "error":
      body.appendChild(el("div", "fv-notice", content.message));
      break;
    case "text": {
      const source = textSource(content.text, lang);
      rows = renderRows(body, source, lang, view, rowPx);
      shownText = { lines: source.lines, search: null, scrollToLine: rows.scrollToLine };
      break;
    }
    case "paged": {
      const key = `${model.root}\n${active}`;
      lastPages = { key, pages: new Map() };
      const stale = previous?.key === key ? previous.pages : undefined; // no blank rows while a refresh fetches the pages again
      rows = renderRows(body, pagedSource(content.file, lang, lastPages.pages, stale), lang, view, rowPx);
      shownText = { lines: null, search: content.file.search, scrollToLine: rows.scrollToLine };
      break;
    }
  }
  rootEl.appendChild(body);

  const crumb = el("div", "fv-breadcrumb");
  const segments = [rootName, ...(active === null ? [] : active.split("/"))];
  segments.forEach((segment, i) => {
    if (i > 0) crumb.appendChild(el("span", "fv-breadcrumb__sep", " › "));
    crumb.appendChild(el("span", "fv-breadcrumb__seg", segment));
  });
  crumb.appendChild(el("span", "fv-readonly", "Read-only"));
  rootEl.appendChild(crumb);

  // Last: the breadcrumb changes the body height (edge case 31), and the first paint needs the final height.
  // scrollLeft comes after the paint: the painted rows give the scroll width.
  if (rows) {
    rows.place();
    body.scrollLeft = view.scrollLeft ?? 0;
  }
}
```

**edit (fileViewer.test.ts):**
- **a.** Change `import { describe, expect, it } from "vitest";` to `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";`. In the fileViewer import list, add `  type FileViewerModel,` after `  type FileViewerCallbacks,`.
- **b.** Replace every `{ scrollTop: 0, currentLine: null }` with `{ topLine: 0, currentLine: null }`. That is the `render` helper default, the `viewOf` `toEqual`, and the "marks no tab active" test.
- **c.** In "closeTab deletes the view of the closed tab only", change `viewOf(s, "a").scrollTop = 5;`, `viewOf(s, "b").scrollTop = 9;` and `expect(viewOf(s, "b").scrollTop).toBe(9);` to use `topLine` instead of `scrollTop`.
- **d.** Delete the `it.each` row `    [{ kind: "tooLarge", size: 3 * 1048576 }, "File too large to show (3.0 MB, limit 2 MB)"],`.
- **e.** Delete the whole test `it("renders 5,000 rows and a notice for 5,001 lines", ...)`.
- **f.** Insert before `describe("tab view (W3)", () => {`:
  ```ts
  const rowPx = (root: HTMLElement): number => parseInt(root.querySelector<HTMLElement>(".fv-lines")!.style.getPropertyValue("--fv-row"));
  const shown = (root: HTMLElement): number[] => Array.from(root.querySelectorAll<HTMLElement>(".fv-line"), (row) => Number(row.dataset.line));
  const manyLines = (n: number, line: (i: number) => string = (i) => `l${i}`): string => Array.from({ length: n }, (_, i) => line(i)).join("\n");

  function scrollTo(root: HTMLElement, line: number): void {
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = line * rowPx(root);
    body.dispatchEvent(new Event("scroll"));
  }

  function paged(lineCount: number, calls: number[][] = []): ViewerContent {
    return {
      kind: "paged",
      file: {
        lineCount,
        readLines: (start, n) => {
          calls.push([start, n]);
          return Promise.resolve(Array.from({ length: Math.min(n, lineCount - start) }, (_, i) => `p${start + i}`));
        },
        search: () => Promise.resolve({ matches: [], truncated: false }),
      },
    };
  }

  describe("virtual rows", () => {
    // jsdom has no layout: give every element a 200 px viewport. A braced body: a returned spy would run as teardown.
    beforeEach(() => {
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    });
    afterEach(() => vi.restoreAllMocks());

    it("renders only the rows near the viewport, and the rows of a deep scroll", () => {
      const root = render({ content: { kind: "text", text: manyLines(100_000) } });
      expect(root.querySelector<HTMLElement>(".fv-lines")!.style.height).toBe(`${100_000 * rowPx(root)}px`);
      expect(shown(root)[0]).toBe(0);
      expect(shown(root).length).toBeLessThan(100);
      scrollTo(root, 99_990);
      expect(shown(root)).toContain(99_999);
      expect(root.querySelector('.fv-line[data-line="99999"] .fv-line__text')?.textContent).toBe("l99999");
      expect(root.querySelector(".fv-notice")).toBeNull();
    });

    it("carries a block comment into a deep row through the checkpoints", () => {
      const open = render({ content: { kind: "text", text: "/*\n" + manyLines(5000, () => "const") } });
      scrollTo(open, 4000);
      expect(open.querySelector('.fv-line[data-line="4000"] .tok-comment')?.textContent).toBe("const");
      scrollTo(open, 1000); // back up: the walk starts at a stored checkpoint
      expect(open.querySelector('.fv-line[data-line="1000"] .tok-comment')?.textContent).toBe("const");
      const closed = render({ content: { kind: "text", text: "/* */\n" + manyLines(5000, () => "const") } });
      scrollTo(closed, 4000);
      expect(closed.querySelector('.fv-line[data-line="4000"] .tok-keyword')?.textContent).toBe("const");
    });

    it("caps the spacer of a very long file and still reaches its middle and last lines", () => {
      const root = render({ content: { kind: "text", text: manyLines(1_000_000) } });
      expect(root.querySelector<HTMLElement>(".fv-lines")!.style.height).toBe("16000000px");
      const body = root.querySelector<HTMLElement>(".fv-body")!;
      body.scrollTop = 8_000_000;
      body.dispatchEvent(new Event("scroll"));
      expect(shown(root)).toContain(500_000);
      body.scrollTop = 16_000_000;
      body.dispatchEvent(new Event("scroll"));
      expect(shown(root)).toContain(999_999);
    });

    it("keeps the top line when a refresh render adds lines to a scaled file", () => {
      const view: TabView = { topLine: 0, currentLine: null };
      const root = document.createElement("div");
      const model = (n: number): FileViewerModel => ({ root: ROOT, tabs: ["a.ts"], active: "a.ts", content: { kind: "text", text: manyLines(n) }, view });
      renderFileViewer(root, model(1_000_000), 13);
      const body = root.querySelector<HTMLElement>(".fv-body")!;
      body.scrollTop = 8_000_000;
      body.dispatchEvent(new Event("scroll"));
      const top = view.topLine;
      renderFileViewer(root, model(1_100_000), 13);
      expect(view.topLine).toBe(top);
      expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).not.toBe(8_000_000); // the same line, a new scroll position
      expect(shown(root)[0]).toBe(Math.floor(top) - 20);
    });

    it("keeps the scroll width of the widest painted row after a scroll into short lines and a refresh", () => {
      // jsdom has no layout: a text span is 8 px per character.
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
        return (this.textContent?.length ?? 0) * 8;
      });
      const view: TabView = { topLine: 0, currentLine: null };
      const text = manyLines(1000, (i) => (i === 0 ? "x".repeat(500) : "y"));
      const root = render({ content: { kind: "text", text }, view });
      const width = (r: HTMLElement): string => r.querySelector<HTMLElement>(".fv-lines")!.style.width;
      expect(width(root)).toBe("4000px");
      scrollTo(root, 600);
      expect(width(root)).toBe("4000px");
      expect(width(render({ content: { kind: "text", text }, view }))).toBe("4000px");
    });

    it("clamps the current line when a new render makes the file shorter", () => {
      const view: TabView = { topLine: 0, currentLine: 9 };
      const root = render({ content: { kind: "text", text: "a\nb\nc" }, view });
      expect(view.currentLine).toBe(2);
      expect(root.querySelector(".fv-line.is-current")?.getAttribute("data-line")).toBe("2");
    });

    it("paged mode shows placeholder rows, fetches the page near the viewport, then shows its lines", async () => {
      const calls: number[][] = [];
      const root = render({ content: paged(100_000, calls) });
      expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("");
      expect(calls).toEqual([[0, 500]]);
      await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("p0"));
      scrollTo(root, 70_000);
      expect(calls).toContainEqual([70_000, 500]);
      await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="70000"] .fv-line__text')?.textContent).toBe("p70000"));
    });

    it("paged mode keeps at most 8 pages and fetches a dropped page again", () => {
      const calls: number[][] = [];
      const root = render({ content: paged(100_000, calls) });
      for (let line = 1000; line <= 9000; line += 1000) scrollTo(root, line);
      scrollTo(root, 0);
      expect(calls.filter(([start]) => start === 0)).toHaveLength(2);
    });

    it("paged mode shows the old lines while a refresh render fetches the pages again", async () => {
      const root = document.createElement("div");
      const model = (content: ViewerContent): FileViewerModel => ({ root: ROOT, tabs: ["a.ts"], active: "a.ts", content, view: { topLine: 0, currentLine: null } });
      renderFileViewer(root, model(paged(100)), 13);
      await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("p0"));
      const pending: ViewerContent = {
        kind: "paged",
        file: { lineCount: 100, readLines: () => new Promise(() => {}), search: () => Promise.resolve({ matches: [], truncated: false }) },
      };
      renderFileViewer(root, model(pending), 13);
      expect(root.querySelector('.fv-line[data-line="0"] .fv-line__text')?.textContent).toBe("p0");
    });
  });

  ```
- **g.** In `describe("tab view (W3)")`, rewrite three tests. jsdom rows are `rowPx = 18`, and `clientHeight` is 0 here.
  - "restores the scroll position and the current line": use `render({ view: { topLine: 2, currentLine: 3 } })` and `expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).toBe(2 * rowPx(root));`. Keep the `is-current` assertion.
  - "saves the scroll position and the clicked line": use `const view: TabView = { topLine: 0, currentLine: null };`, then `body.scrollTop = 2 * rowPx(root);`, the scroll dispatch, and `expect(view.topLine).toBe(2);`. Keep the click part.
  - "restores both again on a re-render with the same view": use `view = { topLine: 0, currentLine: null }`, `body.scrollTop = rowPx(root);` and, after the re-render, `expect(root.querySelector<HTMLElement>(".fv-body")!.scrollTop).toBeCloseTo(rowPx(root));`.
- **h.** Before `  it("does not throw when no tab is active", () => {`, insert:
  ```ts
    it("saves and restores the horizontal scroll position", () => {
      const view: TabView = { topLine: 0, currentLine: null };
      const body = render({ view }).querySelector<HTMLElement>(".fv-body")!;
      body.scrollLeft = 40;
      body.dispatchEvent(new Event("scroll"));
      expect(view.scrollLeft).toBe(40);
      expect(render({ view }).querySelector<HTMLElement>(".fv-body")!.scrollLeft).toBe(40);
    });

  ```

**lines:**
- fileViewer.ts: Region A 18 removed + ~66 added; `viewOf` 1; Region B ~88 removed + ~240 added.
- Test file: about 10 edits + ~125 added, ~8 removed.

**exec:** judgment. Large region replacements in a dirty file; `renderFileTabs` and the tab helpers must stay intact.

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/ui/fileViewer.test.ts 2>&1 | grep "Tests "` gives `35 passed`. Skip tsc here: `appFiles.ts` builds `tooLarge` until step 8.

### step 7: find over all lines (text) or the backend (paged), with Searching state and cancel

**files:** `gui/src/ui/viewerFind.ts` (untracked; rewrite it), `gui/tests/unit/ui/viewerFind.test.ts`

**edit (viewerFind.ts):** the whole new content.
```ts
// Find in the file viewer (Ctrl+F): a bar at the viewer's top-right, Enter/Shift+Enter for next/previous, Esc to
// close. The viewer renders only the rows near the viewport, so the search runs over the file, not over the DOM:
// over the lines in memory (text mode), or through the backend `fs_search` after a pause in typing (paged mode).
// The CSS Custom Highlight API marks the matches of the rendered rows, again after each row change.

import type { SearchResult } from "../files/filesApi";
import { onViewerRows, viewerText, type ViewerText } from "./fileViewer";

export interface LineMatch {
  line: number;
  start: number;
  end: number;
}

/** Case-insensitive, non-overlapping matches of `query` in each line, in reading order. */
export function findMatches(lines: readonly string[], query: string): LineMatch[] {
  if (query === "") return [];
  const needle = query.toLowerCase();
  const out: LineMatch[] = [];
  lines.forEach((text, line) => {
    const hay = text.toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      out.push({ line, start: at, end: at + needle.length });
    }
  });
  return out;
}

/** The next index after `current`, wrapping; -1 when there are no matches. */
export function stepIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

const ALL = "fv-find";
const CURRENT = "fv-find-current";
/** Paged mode: the pause after the last key before the backend search starts. */
const SEARCH_DELAY_MS = 250;

let barEl: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let countEl: HTMLSpanElement | null = null;
let matches: LineMatch[] = [];
let truncated = false; // paged mode: the backend stopped at its match limit
let index = -1;
let searched: ViewerText | null = null; // the render that `matches` belong to
let searchSeq = 0; // drops a backend answer to an older query
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false; // paged mode: a backend search is due or runs; the bar shows "Searching…"
let failure: string | null = null; // paged mode: the error of the last backend search
let running: ((query: string) => Promise<SearchResult>) | null = null; // the backend of a search that has not answered

// The DOM lib for ES2020 types HighlightRegistry without its Map methods.
interface Registry {
  set(name: string, highlight: Highlight): unknown;
  delete(name: string): boolean;
}

/** WebView2 and Safari 17.2+ have it; jsdom does not, so the bar still counts without marks there. */
function highlights(): Registry | null {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"
    ? (CSS.highlights as unknown as Registry)
    : null;
}

/** A DOM range over `[start, end)` of a line element's text, across its token spans. */
function rangeIn(lineEl: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

function showCount(): void {
  if (!countEl) return;
  const counted = `${matches.length === 0 ? 0 : index + 1}/${matches.length}${truncated ? "+" : ""}`;
  countEl.textContent = pending ? "Searching…" : (failure ?? (inputEl?.value ? counted : ""));
}

/** Marks the matches of the rendered rows. The viewer calls it after each row change (`onViewerRows`). */
function mark(): void {
  const text = viewerText();
  if (text !== searched) {
    // A new render (a refresh). Text mode searches the new lines and keeps the place, without a scroll. Paged mode
    // keeps its matches: a backend search on each refresh of a growing log would not end before the next refresh.
    searched = text;
    if (text?.lines) {
      matches = findMatches(text.lines, inputEl?.value ?? "");
      index = matches.length === 0 ? -1 : Math.min(Math.max(index, 0), matches.length - 1);
      showCount();
    }
  }
  const registry = highlights();
  if (!registry) return;
  const rows = Array.from(barEl?.parentElement?.querySelectorAll<HTMLElement>(".fv-line") ?? []);
  // The rows are consecutive lines, and the matches are in line order: find the first match of the first row.
  const first = rows.length > 0 ? Number(rows[0].dataset.line) : 0;
  let k = 0;
  let hi = matches.length;
  while (k < hi) {
    const mid = (k + hi) >> 1;
    if (matches[mid].line < first) k = mid + 1;
    else hi = mid;
  }
  const all: Range[] = [];
  let current: Range | null = null;
  for (const row of rows) {
    const line = Number(row.dataset.line);
    const textEl = row.querySelector(".fv-line__text");
    for (; k < matches.length && matches[k].line === line; k++) {
      const range = textEl && rangeIn(textEl, matches[k].start, matches[k].end);
      if (!range) continue;
      all.push(range);
      if (k === index) current = range;
    }
  }
  registry.set(ALL, new Highlight(...all));
  if (current) registry.set(CURRENT, new Highlight(current));
  else registry.delete(CURRENT);
}

/** Updates the count. With `scroll`, puts the line of the current match in the middle of the viewport. */
function show(scroll: boolean): void {
  showCount();
  if (scroll && index >= 0) viewerText()?.scrollToLine(matches[index].line);
  mark();
}

function setMatches(next: LineMatch[], cut: boolean): void {
  matches = next;
  truncated = cut;
  index = next.length > 0 ? 0 : -1;
  show(true);
}

/** Stops a backend search that runs: an empty query bumps the search generation in Rust (files.rs `fs_search`). */
function cancelBackend(): void {
  if (running) void running("").catch(() => {});
  running = null;
}

function search(): void {
  const text = viewerText();
  const query = inputEl?.value ?? "";
  const backend = text?.search;
  searched = text;
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  pending = false;
  failure = null;
  if (!backend || query === "") {
    cancelBackend();
    setMatches(findMatches(text?.lines ?? [], query), false);
    return;
  }
  // Paged mode: no stale count and no Enter on old matches while the backend searches.
  pending = true;
  setMatches([], false);
  searchTimer = setTimeout(() => {
    running = backend;
    backend(query).then(
      (result) => {
        if (seq !== searchSeq) return;
        running = null;
        pending = false;
        setMatches(result.matches.map((m) => ({ line: m.line, start: m.col, end: m.col + query.length })), result.truncated);
      },
      (err: { code?: string; message?: string } | undefined) => {
        if (seq !== searchSeq || err?.code === "cancelled") return; // a newer search replaced this one
        running = null;
        pending = false;
        failure = err?.message ?? String(err);
        showCount();
      },
    );
  }, SEARCH_DELAY_MS);
}

export function isViewerFindOpen(): boolean {
  return barEl !== null;
}

/** Opens (or refocuses) the bar in `viewer`; with text selected in the viewer, searches for it. */
export function openViewerFind(viewer: HTMLElement): void {
  const selected = window.getSelection()?.toString() ?? "";
  if (!barEl || !viewer.contains(barEl)) {
    closeViewerFind();
    const bar = document.createElement("div");
    bar.className = "find-bar fv-find-bar";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "find-bar__input";
    input.placeholder = "Find in file";
    input.setAttribute("aria-label", "Find in file");
    const count = document.createElement("span");
    count.className = "find-bar__count";
    bar.append(input, count);
    input.addEventListener("input", search);
    input.addEventListener("keydown", (event) => {
      event.stopPropagation(); // Esc must not also hide the viewer; keys must not reach the terminal
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewerFind();
        viewer.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (pending) return; // the matches of the last query are gone
        index = stepIndex(index, matches.length, event.shiftKey ? -1 : 1);
        show(true);
      }
    });
    viewer.appendChild(bar);
    barEl = bar;
    inputEl = input;
    countEl = count;
    onViewerRows(mark);
  }
  if (selected && !selected.includes("\n") && inputEl) {
    inputEl.value = selected;
    search();
  }
  inputEl?.focus();
  inputEl?.select();
}

/** Closes the bar, clears the marks and stops a backend search; called on Esc, on a full render and when the viewer hides. */
export function closeViewerFind(): void {
  barEl?.remove();
  barEl = null;
  inputEl = null;
  countEl = null;
  matches = [];
  truncated = false;
  index = -1;
  searched = null;
  pending = false;
  failure = null;
  clearTimeout(searchTimer);
  ++searchSeq;
  cancelBackend();
  onViewerRows(null);
  highlights()?.delete(ALL);
  highlights()?.delete(CURRENT);
}
```

**edit (viewerFind.test.ts):**
- Change `import { afterEach, describe, expect, it } from "vitest";` to:
  ```ts
  import { afterEach, describe, expect, it, vi } from "vitest";
  import type { SearchResult } from "../../../src/files/filesApi";
  import { renderFileViewer, type ViewerContent } from "../../../src/ui/fileViewer";
  ```
- Keep the `findMatches` and `stepIndex` describes.
- Replace the whole `describe("the bar", ...)` block (`viewerFind.test.ts:33-86`) with:
```ts
describe("the bar", () => {
  afterEach(() => {
    closeViewerFind();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.textContent = "";
  });

  /** Renders `content` into `root` (a new element by default), as the viewer does. A re-render must not move `root`. */
  function viewer(content: ViewerContent, root: HTMLElement = document.createElement("div")): HTMLElement {
    if (!root.isConnected) document.body.appendChild(root);
    renderFileViewer(root, { root: "/p", tabs: ["a.ts"], active: "a.ts", content, view: { topLine: 0, currentLine: null } }, 13);
    return root;
  }

  const text = (t: string): ViewerContent => ({ kind: "text", text: t });

  function type(root: HTMLElement, value: string): void {
    const input = root.querySelector<HTMLInputElement>(".find-bar__input")!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }

  const count = (root: HTMLElement): string | null => root.querySelector(".find-bar__count")!.textContent;

  /** jsdom has no CSS Custom Highlight API: a Map stands in for the registry. */
  function stubHighlights(): Map<string, { ranges: Range[] }> {
    const registry = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal(
      "Highlight",
      class {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    return registry;
  }

  function pagedContent(search: (query: string) => Promise<SearchResult>): ViewerContent {
    const readLines = (start: number, n: number): Promise<string[]> => Promise.resolve(Array.from({ length: n }, (_, i) => `l${start + i}`));
    return { kind: "paged", file: { lineCount: 1_000_000, readLines, search } };
  }

  it("counts matches and steps with Enter and Shift+Enter", () => {
    const root = viewer(text("return x\nno match\nRETURN y"));
    openViewerFind(root);
    const input = root.querySelector<HTMLInputElement>(".find-bar__input")!;
    type(root, "return");
    expect(count(root)).toBe("1/2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(count(root)).toBe("2/2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
    expect(count(root)).toBe("1/2");
    type(root, "zzz");
    expect(count(root)).toBe("0/0");
  });

  it("finds a line far past the rendered rows and renders its row", () => {
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const root = viewer(text(Array.from({ length: 100_000 }, (_, i) => (i === 90_000 ? "needle" : `l${i}`)).join("\n")));
    expect(root.querySelector('.fv-line[data-line="90000"]')).toBeNull();
    openViewerFind(root);
    type(root, "needle");
    expect(count(root)).toBe("1/1");
    expect(root.querySelector('.fv-line[data-line="90000"] .fv-line__text')?.textContent).toBe("needle");
  });

  it("marks the matches of the rendered rows only, across token spans, and again after a scroll", () => {
    const registry = stubHighlights();
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const root = viewer(text(Array.from({ length: 1000 }, () => "return x").join("\n")));
    openViewerFind(root);
    type(root, "rn x"); // crosses the keyword span and the plain text after it
    expect(count(root)).toBe("1/1000");
    const rendered = root.querySelectorAll(".fv-line").length;
    expect(rendered).toBeLessThan(1000);
    expect(registry.get("fv-find")!.ranges).toHaveLength(rendered);
    expect(registry.get("fv-find")!.ranges[0].toString()).toBe("rn x");
    expect(registry.has("fv-find-current")).toBe(true);
    const body = root.querySelector<HTMLElement>(".fv-body")!;
    body.scrollTop = 600 * parseInt(root.querySelector<HTMLElement>(".fv-lines")!.style.getPropertyValue("--fv-row"));
    body.dispatchEvent(new Event("scroll"));
    const firstRow = root.querySelector<HTMLElement>(".fv-line")!;
    expect(firstRow.dataset.line).not.toBe("0");
    expect(registry.get("fv-find")!.ranges[0].startContainer.parentElement?.closest(".fv-line")).toBe(firstRow);
    expect(registry.has("fv-find-current")).toBe(false); // match 1 is on line 0, off screen now
  });

  it("keeps the bar and its focus over a refresh render, and searches the new lines", () => {
    const root = viewer(text("a\nb"));
    openViewerFind(root);
    type(root, "c");
    expect(count(root)).toBe("0/0");
    const input = root.querySelector(".find-bar__input");
    viewer(text("c\nc"), root); // what a refresh does: the same element, new text
    expect(root.querySelector(".find-bar__input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(count(root)).toBe("1/2");
  });

  it("searches a paged file through the backend after a pause, shows Searching meanwhile, and marks a capped count with +", async () => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(200);
    const queries: string[] = [];
    const root = viewer(
      pagedContent((query) => {
        queries.push(query);
        return Promise.resolve({ matches: [{ line: 900_000, col: 1 }], truncated: true });
      }),
    );
    openViewerFind(root);
    const input = root.querySelector<HTMLInputElement>(".find-bar__input")!;
    type(root, "9");
    type(root, "90");
    expect(queries).toEqual([]);
    expect(count(root)).toBe("Searching…");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); // no old matches to step
    expect(count(root)).toBe("Searching…");
    await vi.advanceTimersByTimeAsync(300);
    expect(queries).toEqual(["90"]);
    expect(count(root)).toBe("1/1+");
    await vi.waitFor(() => expect(root.querySelector('.fv-line[data-line="900000"] .fv-line__text')?.textContent).toBe("l900000"));
  });

  it("shows a backend error in the bar", async () => {
    vi.useFakeTimers();
    const root = viewer(pagedContent(() => Promise.reject({ code: "io_error", message: "disk gone" })));
    openViewerFind(root);
    type(root, "x");
    await vi.advanceTimersByTimeAsync(300);
    expect(count(root)).toBe("disk gone");
  });

  it("stops a running backend search when the query empties and when the bar closes", async () => {
    vi.useFakeTimers();
    const queries: string[] = [];
    const root = viewer(
      pagedContent((query) => {
        queries.push(query);
        return new Promise(() => {});
      }),
    );
    openViewerFind(root);
    type(root, "x");
    await vi.advanceTimersByTimeAsync(300);
    type(root, "");
    expect(queries).toEqual(["x", ""]);
    type(root, "y");
    await vi.advanceTimersByTimeAsync(300);
    closeViewerFind();
    expect(queries).toEqual(["x", "", "y", ""]);
  });

  it("Esc closes the bar without the event reaching the viewer", () => {
    const root = viewer(text("x"));
    let reached = false;
    root.addEventListener("keydown", () => (reached = true));
    openViewerFind(root);
    root.querySelector(".find-bar__input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isViewerFindOpen()).toBe(false);
    expect(root.querySelector(".find-bar")).toBeNull();
    expect(reached).toBe(false);
  });

  it("opening twice keeps one bar", () => {
    const root = viewer(text("x"));
    openViewerFind(root);
    openViewerFind(root);
    expect(root.querySelectorAll(".find-bar")).toHaveLength(1);
  });
});
```

**lines:** viewerFind.ts ~45 removed + ~140 added; test ~55 removed + ~185 added.

**exec:** judgment. Module rewrite with async, debounce and cancel logic.

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/ui/viewerFind.test.ts 2>&1 | grep "Tests "` gives `12 passed`.

### step 8: freshness, paged content, keep find on refresh, cancel on any hide

**files:** `gui/src/appFiles.ts`

**edit** (anchors on current text):
- **a.** Line 10: `import { fsListDir, fsReadText, type DirEntry } from "./files/filesApi";` becomes `import { fsListDir, fsOpenPaged, fsReadLines, fsReadText, fsSearch, fsStat, type DirEntry } from "./files/filesApi";`.
- **b.** After `let readSeq = 0; // drops stale reads (spec §5)`, add:
  ```ts
  let reading = false; // a read is in flight: the poll waits, so a read slower than POLL_MS still finishes
  let stamp: string | null = null; // "mtimeMs:size" of the shown file at its last read; null when it could not be read
  const POLL_MS = 2000;
  const MAX_SEARCH_MATCHES = 10_000; // paged find: the count shows "+" past this
  ```
- **c.** Replace `  new MutationObserver(renderTabsBar).observe(fileViewerEl, { attributes: true, attributeFilter: ["hidden"] });` (line 212) with:
  ```ts
    // A hide also closes find, which stops its backend search: the diff view hides the viewer without hideFileViewer.
    new MutationObserver(() => {
      if (fileViewerEl.hidden) closeViewerFind();
      renderTabsBar();
    }).observe(fileViewerEl, { attributes: true, attributeFilter: ["hidden"] });
    // Freshness (D7, revised): read the shown file again on window focus, and poll its stat while the viewer shows.
    // The interval checks `hidden` on each tick: the diff view hides the viewer directly (appSourceControl.ts openFile).
    window.addEventListener("focus", () => {
      if (!fileViewerEl.hidden && !reading) void readActive(true); // a read in flight brings the new content already
    });
    window.setInterval(() => {
      if (!fileViewerEl.hidden && !document.hidden) void pollActive();
    }, POLL_MS);
  ```
- **d.** Replace everything from `function renderViewer(): void {` through the closing `}` of `readActive` (the line before `function openFileInViewer`) with:
  ```ts
  /** `keepFind`: a refresh keeps the find bar open over text or paged content; the bar marks the new rows (viewerFind.ts). */
  function renderViewer(keepFind = false): void {
    if (!current || current.active === null) return;
    const hadFocus = fileViewerEl.contains(document.activeElement); // read first: closing the bar or the render can drop focus
    // Otherwise its marks point into the lines this render replaces.
    if (!keepFind || (content.kind !== "text" && content.kind !== "paged")) closeViewerFind();
    renderFileViewer(
      fileViewerEl,
      { root: current.root, tabs: current.tabs, active: current.active, content, view: viewOf(current, current.active) },
      appState.renderer?.getFontSizePx() ?? appState.settings.fontSize,
    );
    // Esc, Ctrl+F and the file-tab keys (routing.ts) work only while focus is inside the viewer.
    if (hadFocus && !fileViewerEl.contains(document.activeElement)) fileViewerEl.focus();
    renderTabsBar();
  }

  /** "mtimeMs:size" of a file, or null when it cannot be read. */
  async function statStamp(root: string, rel: string): Promise<string | null> {
    try {
      const stat = await fsStat(root, rel);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  /** The 2 s poll: reads the active file again only when its stat changed after the last read. */
  async function pollActive(): Promise<void> {
    const ws = current;
    if (reading || !ws || ws.active === null) return;
    const seq = readSeq;
    const next = await statStamp(ws.root, ws.active);
    if (seq === readSeq && next !== stamp) void readActive(true);
  }

  /**
   * Reads the active file. A tab activation shows "Loading…" first. A `refresh` (window focus, a click on the active
   * tab, the poll) keeps the shown content, its scroll position, its current line and the find bar until the new content arrives.
   */
  async function readActive(refresh = false): Promise<void> {
    const ws = current;
    if (!ws || ws.active === null) return;
    const root = ws.root;
    const rel = ws.active;
    const seq = ++readSeq;
    reading = true;
    if (!refresh) {
      content = { kind: "loading" };
      renderViewer();
    }
    const nextStamp = await statStamp(root, rel); // before the read: a write during the read shows at the next poll
    let next: ViewerContent;
    try {
      const result = await fsReadText(root, rel);
      if (result.kind === "text") next = { kind: "text", text: result.content ?? "" };
      else if (result.kind === "binary") next = { kind: "binary" };
      else {
        // Paged mode (8 MiB and more): the backend indexes the lines; the viewer fetches only the rows it shows.
        const lineCount = await fsOpenPaged(root, rel);
        next = {
          kind: "paged",
          file: {
            lineCount,
            readLines: (start, count) => fsReadLines(root, rel, start, count),
            search: (query) => fsSearch(root, rel, query, MAX_SEARCH_MATCHES),
          },
        };
      }
    } catch (err) {
      next = (err as { code?: string })?.code === "not_found" ? { kind: "missing" } : { kind: "error", message: errorMessage(err) };
    }
    if (seq !== readSeq) return;
    reading = false;
    // The same content again: no render, so a text selection and the loaded rows stay.
    const same =
      refresh &&
      (next.kind === "text" && content.kind === "text"
        ? next.text === content.text
        : next.kind === "paged" && content.kind === "paged" && nextStamp !== null && nextStamp === stamp);
    stamp = nextStamp;
    if (same || fileViewerEl.hidden) return; // hidden: the diff view hid the viewer during the read (appSourceControl.ts openFile)
    content = next;
    renderViewer(refresh);
  }
  ```
- **e.** In `activateTab`, replace `  if (current.active === rel) return; // W3: a click on the active tab does not read again` with:
  ```ts
    if (current.active === rel) {
      if (!reading) void readActive(true); // reverses W3: a click on the active tab reads the file again, without "Loading…"
      return;
    }
  ```

**lines:** a 2, b 4, c 1 removed + 13 added, d ~27 removed + ~85 added, e 1 removed + 4 added.

**exec:** judgment. Async ordering in a dirty file, and there are no unit tests for `appFiles` (impl doc line 1324).

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run 2>&1 | grep -E "Test Files|Tests "` gives no tsc output, `76 passed (76)` files and `949 passed (949)` tests.

### step 9: update the design spec

**files:** `gui/docs/file-viewer-spec.md`

**edit** (exact replacements):
- **Line 26.** Old: `| D7 | No file watcher. The viewer re-reads on tab activation; the tree re-reads on expand and on refresh. | Live watcher. |`
  New: `| D7 | No file watcher. The viewer reads the file again on tab activation, on a click on the active tab, on window focus, and when a 2 s \`fs_stat\` poll sees a new mtime or size. The tree re-reads on expand and on refresh. | Live watcher (new crate). |`
- **Lines 52-53.** Replace the `ReadResult` bullet and the `tooLarge` bullet with three bullets:
  - `` - `ReadResult` is `{ kind: "text" | "binary" | "paged", content: Option<String>, size: u64 }`. ``
  - `- A file of 8 MiB or more returns \`paged\` without content. The viewer then calls \`fs_open_paged\` (the line count), \`fs_read_lines\` and \`fs_search\`. A line index in Rust state (at most 8 files) serves these commands. An append extends the index; any other change builds it again.`
  - `- \`fs_stat(root, rel) -> { mtimeMs, size }\` feeds the freshness poll.`
- **Line 92.** Old: `  - The viewer calls \`fs_read_text\` each time a tab becomes active.`
  New: `  - The viewer calls \`fs_read_text\` when a tab becomes active, on a click on the active tab, and on window focus. A 2 s \`fs_stat\` poll reads again when the mtime or the size changes. A refresh keeps the top line, the current line and the find bar.`
- **Lines 159-160.** Old:
  - `- The viewer renders at most 5,000 lines. A longer file shows a notice under line 5,000.`
  - `- Notices replace the body for \`binary\`, \`tooLarge\` and missing files.`

  New:
  - `- The viewer renders only the rows near the viewport (virtual rows). All rows have one height. Find in the file searches all lines, not the rendered rows.`
  - `- Notices replace the body for \`binary\` and missing files.`
- **Line 183.** Change `binary, too-large and missing notices.` to `binary and missing notices; virtual rows; paged rows.`
- **Line 191.** Old: `- Binary detection, 2 MB cap, lossy UTF-8.`
  New: `- Binary detection, paged threshold, lossy UTF-8, line index (build and append), line reads, search and its cancel.`
- **Line 211.** Old: `- DOM render of 5,000 highlighted lines can stutter. If the live check shows lag, virtual scrolling becomes the first slice.`
  New: `- Native selection covers only the rendered rows. Paged mode colours each page from a null tokenizer state and cuts lines at 64 KiB. A multi-GB file that is rewritten (not appended) is indexed again in full at each change.`

**lines:** 7 edits, about 17 lines.

**exec:** mechanical. Exact old and new text.

**verify:** `cd /c/Users/Reinaldo/Backend/herdr/gui && grep -q "fs_stat" docs/file-viewer-spec.md && ! grep -qE "tooLarge|5,000" docs/file-viewer-spec.md && echo ok` gives `ok`.

## Overall verify

`cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run && cd src-tauri && cargo test && rustfmt --edition 2021 --check src/files.rs && ! cargo clippy -- -D warnings 2>&1 | grep -E "src.(files|lib)\.rs"`

Expected:
- tsc is silent.
- vitest: 76 files / 949 tests passed.
- cargo test: all ok (lib 375 passed; `files::tests` 32).
- rustfmt is silent.
- grep is empty.
- The full clippy still fails only on the pre-existing `flutter.rs:498`/`:604`.

Not checked:
- The real-crate Rust compile happens at the step 1–3 verifies.
- Every live behaviour in the acceptance list: the echo-scroll guard, `overflow-y: clip` with the sticky gutter, focus while typing, 150 % scaling, and CPU falling after a cancel.

Skipped, as the user decided: build dedup for concurrent scans.

Risk to know: a rewrite that grows a file and keeps `\n` at the old last offset is indexed as an append, so its rows can show wrong lines until a later change fails the check.
