import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every stubbed module under test (decoder, grid, agents, usage,
    // keymap, colours) is a pure function over plain data -- no DOM/canvas
    // needed, so the default "node" environment avoids an extra jsdom
    // dependency.
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
  },
});
