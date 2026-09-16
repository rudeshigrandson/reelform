import { describe, expect, it } from "vitest";
import { WINDOW_KINDS } from "./windowKinds";
import { buildWindowOptions } from "./windowOptions";

const ctx = { preloadPath: "/app/dist-electron/preload.cjs" };

describe("background throttling", () => {
  it("is disabled only for the launcher, which hosts the MediaRecorders", () => {
    expect(buildWindowOptions("launcher", ctx).webPreferences.backgroundThrottling).toBe(false);
    for (const kind of WINDOW_KINDS.filter((k) => k !== "launcher")) {
      expect(buildWindowOptions(kind, ctx).webPreferences.backgroundThrottling).toBeUndefined();
    }
  });

  it("never weakens the hardened web preferences for any window", () => {
    for (const kind of WINDOW_KINDS) {
      expect(buildWindowOptions(kind, ctx).webPreferences).toMatchObject({
        preload: ctx.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      });
    }
  });
});
