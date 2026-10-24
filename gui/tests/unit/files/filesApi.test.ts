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
