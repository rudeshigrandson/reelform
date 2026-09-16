import * as fsp from "node:fs/promises";
import {
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
  app,
  clipboard,
  dialog,
  shell,
} from "electron";
import type { SystemDeps } from "./handlers";
import type { PickedPathRegistry } from "./pickedPaths";

/**
 * Real deps for {@link createSystemFileHandlers}. Dialogs are parented to the
 * focused window when there is one (sheet on macOS).
 */
export function createElectronSystemDeps(
  opts: {
    focusedWindow?: (() => BrowserWindow | null) | undefined;
    /** Share with `createNodeProjectFileDeps` so picked files are readable/writable. */
    pickedPaths?: PickedPathRegistry | undefined;
  } = {},
): SystemDeps {
  const parent = (): BrowserWindow | null => opts.focusedWindow?.() ?? null;
  return {
    platform: process.platform,
    pickedPaths: opts.pickedPaths,
    pathExists: async (p) => {
      try {
        await fsp.access(p);
        return true;
      } catch {
        return false;
      }
    },
    showItemInFolder: (p) => shell.showItemInFolder(p),
    showOpenDialog: (o) => {
      const options: OpenDialogOptions = { properties: o.properties };
      if (o.title !== undefined) options.title = o.title;
      if (o.defaultPath !== undefined) options.defaultPath = o.defaultPath;
      if (o.filters !== undefined) options.filters = o.filters;
      const win = parent();
      return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
    },
    showSaveDialog: (o) => {
      const options: SaveDialogOptions = { defaultPath: o.defaultPath };
      if (o.filters !== undefined) options.filters = o.filters;
      const win = parent();
      return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
    },
    clipboardWriteBuffer: (format, bytes) =>
      clipboard.writeBuffer(format, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
    defaultSaveDir: () => app.getPath("videos"),
  };
}
