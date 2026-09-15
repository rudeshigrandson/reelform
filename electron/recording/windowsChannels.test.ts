import { describe, expect, it, vi } from "vitest";
import { type WindowsDeps, createWindowsHandlers, windowsContracts } from "../windows/contracts";

/**
 * The recording flow's `windows:*` channels (HUD, countdown, region overlays,
 * webcam bubble, closeKind). Lives here because this workstream owns only the
 * channel additions in `electron/windows/contracts.ts`.
 */

function fakeManager() {
  const keys: string[] = ["launcher"];
  const manager = {
    openEditor: vi.fn(),
    openSettings: vi.fn(),
    openLauncher: vi.fn(),
    openHud: vi.fn(),
    openCountdown: vi.fn(),
    openRegionOverlays: vi.fn(() => {
      keys.push("region-overlay:1", "region-overlay:2");
      return [];
    }),
    setRegionSelecting: vi.fn(),
    openWebcamBubble: vi.fn(),
    closeKind: vi.fn(),
    keys: vi.fn(() => [...keys]),
  };
  return manager;
}

describe("windows recording channels", () => {
  it("names match keys", () => {
    for (const [key, c] of Object.entries(windowsContracts)) expect(c.name).toBe(key);
  });

  it("forward to the window manager", async () => {
    const manager = fakeManager();
    const h = createWindowsHandlers({ manager } as unknown as WindowsDeps);
    await expect(h["windows:openHud"]({ displayId: "2" })).resolves.toEqual({ ok: true });
    expect(manager.openHud).toHaveBeenCalledWith("2");
    await h["windows:openCountdown"]({});
    expect(manager.openCountdown).toHaveBeenCalledWith(undefined);
    await expect(h["windows:openRegionOverlays"]()).resolves.toEqual({
      ok: true,
      displayIds: ["1", "2"],
    });
    await h["windows:setRegionSelecting"]({ displayId: "1", selecting: true });
    expect(manager.setRegionSelecting).toHaveBeenCalledWith("1", true);
    await h["windows:openWebcamBubble"]({ position: { x: 4, y: 5 } });
    expect(manager.openWebcamBubble).toHaveBeenCalledWith({ x: 4, y: 5 });
    await h["windows:closeKind"]({ kind: "countdown" });
    expect(manager.closeKind).toHaveBeenCalledWith("countdown");
  });

  it("only transient recording windows are closable from a renderer", () => {
    const req = windowsContracts["windows:closeKind"].request;
    for (const kind of ["hud", "region-overlay", "countdown", "webcam-bubble"]) {
      expect(req.safeParse({ kind }).success).toBe(true);
    }
    for (const kind of ["launcher", "editor", "settings", "nope"]) {
      expect(req.safeParse({ kind }).success).toBe(false);
    }
    expect(
      windowsContracts["windows:setRegionSelecting"].request.safeParse({
        displayId: "",
        selecting: true,
      }).success,
    ).toBe(false);
  });
});
