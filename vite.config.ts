import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Adds 'unsafe-inline' to the CSP `script-src` in `index.html`. Only for the
 * dev server: @vitejs/plugin-react injects an inline `<script type="module">`
 * react-refresh preamble there, which `script-src 'self'` blocks (HMR then
 * fails with "can't detect preamble"). Builds keep the strict policy.
 */
export function relaxScriptSrcForDev(html: string): string {
  return html.replace(
    /(http-equiv="Content-Security-Policy"\s+content="[^"]*?script-src)([^;"]*)/,
    (match, head: string, sources: string) =>
      sources.includes("'unsafe-inline'") ? match : `${head}${sources} 'unsafe-inline'`,
  );
}

export const devCspPlugin = (): Plugin => ({
  name: "reelform:dev-csp",
  apply: "serve",
  transformIndexHtml: relaxScriptSrcForDev,
});

export default defineConfig({
  resolve: {
    alias: {
      "@contracts": r("./electron/ipc/contracts.ts"),
      "@shared": r("./src/shared"),
      "@design": r("./src/design"),
    },
  },
  plugins: [
    devCspPlugin(),
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
