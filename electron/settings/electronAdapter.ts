import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, app, globalShortcut } from "electron";
import { shortcutPlatformFor } from "../../src/shortcuts/accelerator";
import { settingsEvents } from "./contracts";
import { createGlobalShortcutManager } from "./globalShortcuts";
import { createDefaultSettings } from "./schema";
import { createSettingsStore } from "./store";

/** Thin Electron wiring for the settings store and global shortcuts (untested). */
export function createElectronSettings(onGlobalShortcut: (id: string) => void) {
  const platform = shortcutPlatformFor(process.platform);
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  const store = createSettingsStore({
    fs: {
      readFile: (p) => readFile(p, "utf8"),
      writeFile: (p, d) => writeFile(p, d, "utf8"),
      rename: (a, b) => rename(a, b),
      mkdir: async (p) => {
        await mkdir(p, { recursive: true });
      },
    },
    filePath: join(app.getPath("userData"), "settings.json"),
    defaults: createDefaultSettings({
      recordingsFolder: join(app.getPath("videos"), "Reelform"),
    }),
    platform,
    log: (level, message) => console[level](`[settings] ${message}`),
  });

  const shortcuts = createGlobalShortcutManager({
    globalShortcut,
    platform,
    onTrigger: onGlobalShortcut,
    onStatus: (status) => broadcast(settingsEvents["shortcuts:globalStatusChanged"].name, status),
  });

  store.subscribe((change) => {
    broadcast(settingsEvents["settings:changed"].name, change);
    if (change.changed.includes("shortcuts")) shortcuts.setOverrides(change.settings.shortcuts);
  });
  void store.load().then((s) => shortcuts.setOverrides(s.shortcuts));
  app.on("will-quit", () => shortcuts.dispose());

  return { store, shortcuts };
}
