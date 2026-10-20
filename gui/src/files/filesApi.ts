// File viewer spec §3: the TypeScript side of `src-tauri/src/files.rs`. Each
// wrapper is one `invoke` and rejects with the backend's `{ code, message }`
// `ApiError`. Error codes: `invalid_root`, `outside_root`, `not_found`,
// `not_a_file`, `io_error`, `fs_failed`.

import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface ReadResult {
  kind: "text" | "binary" | "tooLarge";
  /** Set only for `text`. */
  content: string | null;
  size: number;
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

export function fsListFiles(root: string): Promise<FileListing> {
  return invoke<FileListing>("fs_list_files", { root });
}
