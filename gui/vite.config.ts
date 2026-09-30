import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  // Vite options tailored for Tauri development and only applied in
  // `tauri dev` or `tauri build`.
  //
  // 1. Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  // 4. Two pages: the app, and the mirror tools window (docs/mirror-toolbar-spec.md).
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        mirrorTools: fileURLToPath(new URL("./mirror-tools.html", import.meta.url)),
      },
    },
  },
  server: {
    // 2. Tauri expects a fixed port, fail if that port is not available.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. Tell Vite to ignore watching `src-tauri` and the Rust `target/`.
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
}));
