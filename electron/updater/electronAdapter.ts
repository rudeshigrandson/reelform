import { BrowserWindow, app } from "electron";
import electronUpdater from "electron-updater";
import { updaterEvents } from "./contracts";
import type { UpdateChannel } from "./state";
import { type AutoUpdaterPort, createUpdater } from "./updater";

/**
 * Thin Electron wiring (untested). Provider config (GitHub) comes from
 * electron-builder's `app-update.yml`. Unpackaged dev builds never auto-check.
 */
export function createElectronUpdater(opts: {
  channel: UpdateChannel;
  autoCheckEnabled: () => boolean;
}) {
  // electron-updater is CJS; the default import carries `autoUpdater`.
  const autoUpdater = electronUpdater.autoUpdater as unknown as AutoUpdaterPort;
  return createUpdater({
    autoUpdater,
    timers: {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    },
    now: () => Date.now(),
    currentVersion: app.getVersion(),
    channel: opts.channel,
    autoCheckEnabled: () => app.isPackaged && opts.autoCheckEnabled(),
    onChange: (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(updaterEvents["updater:changed"].name, state);
      }
    },
  });
}
