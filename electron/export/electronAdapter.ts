import { randomUUID } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import { nodeRunnerDeps, resolveElectronFfmpegPaths } from "../media/electronAdapter";
import { EXPORTS_DIR } from "../project/paths";
import type { ExportDeps } from "./handlers";

/**
 * Real deps for {@link createExportService}. `resolveProjectDir` maps a
 * projectId to its open `.reelform` folder (owned by whoever tracks open
 * projects); unknown ids fall back to `~/Movies|Videos/Reelform`.
 */
export function createElectronExportDeps(opts: {
  resolveProjectDir: (projectId: string) => string | null | Promise<string | null>;
}): ExportDeps {
  return {
    fs: fsp,
    newId: () => randomUUID(),
    ffmpeg: { runner: nodeRunnerDeps, resolveBinaries: resolveElectronFfmpegPaths },
    defaultExportDir: async (projectId) => {
      const dir = await opts.resolveProjectDir(projectId);
      return dir ? path.join(dir, EXPORTS_DIR) : path.join(app.getPath("videos"), "Reelform");
    },
  };
}
