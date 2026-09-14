import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { app, shell } from "electron";
import type { ProjectDeps, ValidationResult } from "./handlers";
import { probeMediaFile } from "./mediabunnyProbe";
import { createJsonRecentsStore } from "./recents";

/** Real Electron-backed deps for {@link createProjectHandlers}. */
export function createElectronProjectDeps(opts: {
  validate: (doc: unknown) => ValidationResult | Promise<ValidationResult>;
}): ProjectDeps {
  const libraryRoot = path.join(app.getPath("documents"), "Reelform");
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
  };
}
