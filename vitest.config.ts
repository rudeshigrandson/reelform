import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@contracts": r("./electron/ipc/contracts.ts"),
      "@shared": r("./src/shared"),
      "@design": r("./src/design"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Component (.tsx) tests need a DOM; pure-logic .ts tests stay on fast node.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
  },
});
