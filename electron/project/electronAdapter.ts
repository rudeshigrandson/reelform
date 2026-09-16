import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { nodeRunnerDeps, resolveElectronFfmpegPaths } from "../media/electronAdapter";
import { projectEvents } from "./contracts";
import type { ProjectDeps, ValidationResult } from "./handlers";
import { probeMediaFile } from "./mediabunnyProbe";
import { isWithin } from "./paths";
import { createJsonRecentsStore } from "./recents";
import { purgeTrimTrash } from "./trimSource";

/** Projects whose `.trash/` received a trimmed original this session. */
const trimTrashDirs = new Set<string>();

/**
 * Permanently delete this session's trimmed originals (§9.9 "undo-able until
 * app quit"). Pass extra project folders to also sweep leftovers from a crash.
 */
export async function purgeSessionTrimTrash(
  extraProjectDirs: Iterable<string> = [],
): Promise<number> {
  const removed = await purgeTrimTrash([...trimTrashDirs, ...extraProjectDirs], fsp);
  trimTrashDirs.clear();
  return removed;
}

/** Real Electron-backed deps for {@link createProjectHandlers}. */
export function createElectronProjectDeps(opts: {
  validate: (doc: unknown) => ValidationResult | Promise<ValidationResult>;
  /** Pass `createThumbnailUrlResolver({ registry: mediaRoots, realpath })` to serve list thumbnails. */
  thumbnailUrl?: ProjectDeps["thumbnailUrl"];
}): ProjectDeps {
  const libraryRoot = path.join(app.getPath("documents"), "Reelform");
  /** Matches `createRecordingMain`'s default session root (main.ts `recordingsRoot`). */
  const recordingsRoot = path.join(app.getPath("userData"), "recordings");
  return {
    fs: fsp,
    now: () => Date.now(),
    libraryRoot: async () => {
      await fsp.mkdir(libraryRoot, { recursive: true });
      return libraryRoot;
    },
    recents: createJsonRecentsStore({
      fs: fsp,
      filePath: path.join(app.getPath("userData"), "recents.json"),
    }),
    validate: opts.validate,
    trashItem: (p) => shell.trashItem(p),
    probe: probeMediaFile,
    ffmpeg: { runner: nodeRunnerDeps, resolveBinaries: resolveElectronFfmpegPaths },
    onProxyProgress: (e) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed())
          win.webContents.send(projectEvents["project:proxyProgress"].name, e);
      }
    },
    onTrimTrashed: (dir) => {
      trimTrashDirs.add(dir);
    },
    thumbnailUrl: opts.thumbnailUrl,
    // Recording session output (e.g. the background `.h264.mp4`) is app temp: move it in.
    isDisposableMedia: (p) => isWithin(recordingsRoot, p),
    onSourceReplaced: (e) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed())
          win.webContents.send(projectEvents["project:sourceReplaced"].name, e);
      }
    },
  };
}
