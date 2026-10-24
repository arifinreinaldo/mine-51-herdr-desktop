// Pure helpers for the SQLite inspector page (`dbInspector.ts`). No DOM, no Tauri.

/** Rows per page. Same value as `PAGE_ROWS` in `src-tauri/src/android_db.rs`. */
export const PAGE_ROWS = 100;

/** `SELECT * FROM "<name>"` with `"` doubled, so any table name is one identifier. No `replaceAll`: tsconfig lib is ES2020. */
export function tableSql(name: string): string {
  return `SELECT * FROM "${name.replace(/"/g, '""')}"`;
}

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
