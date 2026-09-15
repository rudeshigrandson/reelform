import { BrowserWindow, type BrowserWindowConstructorOptions, screen } from "electron";
import { type ManagedWindow, type WindowConstructor, WindowManager } from "./WindowManager";
import type { HudPositionStore } from "./hudPosition";
import type { WindowOptions } from "./windowOptions";
import type { LoadSource } from "./windowUrl";

/** Thin Electron binding for {@link WindowManager}. Untested by design. */
export function createElectronWindowManager(opts: {
  preloadPath: string;
  loadSource: LoadSource;
  hudPositions: HudPositionStore;
  /** `true` when the HUD is created, `false` once it closed (e.g. tray badge, shortcuts). */
  onHudVisibilityChange?: ((open: boolean) => void) | undefined;
}): WindowManager {
  const Ctor = function (this: unknown, options: WindowOptions) {
    // exactOptionalPropertyTypes: Electron's options reject explicit `undefined`.
    const o = Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined),
    ) as BrowserWindowConstructorOptions;
    return new BrowserWindow(o) as unknown as ManagedWindow;
  } as unknown as WindowConstructor;

  return new WindowManager({
    BrowserWindow: Ctor,
    screen,
    setContentProtection: (win, enabled) =>
      (win as unknown as BrowserWindow).setContentProtection(enabled),
    preloadPath: opts.preloadPath,
    loadSource: opts.loadSource,
    hudPositions: opts.hudPositions,
    onHudVisibilityChange: opts.onHudVisibilityChange,
  });
}
