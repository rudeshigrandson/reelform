import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@contracts": r("./electron/ipc/contracts.ts"),
      "@shared": r("./src/shared"),
      "@design": r("./src/design"),
    },
  },
  plugins: [
    react(),
    electron({
      // The plugin forces ESM lib output for "type":"module" packages, and mergeConfig
      // concatenates `formats`, so disable lib mode and emit CJS via rollup directly.
      // Main is CJS by choice; the preload must be CJS because windows are sandboxed.
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            lib: false,
            outDir: "dist-electron",
            rollupOptions: {
              input: "electron/main.ts",
              output: { entryFileNames: "main.cjs", format: "cjs" },
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            lib: false,
            outDir: "dist-electron",
            rollupOptions: {
              input: "electron/preload.ts",
              output: { entryFileNames: "preload.cjs", format: "cjs" },
            },
          },
        },
      },
    }),
  ],
});
