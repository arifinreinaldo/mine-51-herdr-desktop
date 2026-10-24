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
