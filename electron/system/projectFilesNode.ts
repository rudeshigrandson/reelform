import { constants } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { ProjectFileDeps } from "./projectFiles";

export interface NodeProjectFileOptions {
  /** Defaults to `process.platform`. */
  platform?: string | undefined;
  /** Dialog-picked files (share the registry given to `createElectronSystemDeps`). */
  pickedPaths?: ProjectFileDeps["pickedPaths"];
  /** True when `abs` lies inside a known project folder; see {@link isInsideProjectFolder}. */
  isProjectPath?: ProjectFileDeps["isProjectPath"];
}

const PROJECT_EXT = ".reelform";
const PROJECT_FILE = "project.json";

/**
 * Real path of `abs` with symlinks resolved on its nearest existing ancestor
 * (the file itself may not exist yet for a write).
 */
async function realpathOfNearestExisting(abs: string): Promise<string> {
  const rest: string[] = [];
  let probe = path.resolve(abs);
  for (;;) {
    try {
      const real = await fsp.realpath(probe);
      return rest.length > 0 ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return path.resolve(abs);
      rest.push(path.basename(probe));
      probe = parent;
    }
  }
}

/**
 * True when `abs` (after resolving symlinks) is strictly inside a `*.reelform`
 * folder that holds a `project.json`.
 */
export async function isInsideProjectFolder(abs: string): Promise<boolean> {
  const real = await realpathOfNearestExisting(abs);
  let dir = path.dirname(real);
  for (;;) {
    if (path.extname(dir).toLowerCase() === PROJECT_EXT) {
      try {
        if ((await fsp.stat(path.join(dir, PROJECT_FILE))).isFile()) return true;
      } catch {
        // Not a project folder; keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Node file-system deps for {@link createProjectFileHandlers} (no Electron).
 * Passing a platform string keeps the old signature; passing options with
 * `pickedPaths` and/or `isProjectPath` turns on the §13 access policy.
 */
export function createNodeProjectFileDeps(
  opts: string | NodeProjectFileOptions = {},
): ProjectFileDeps {
  const o: NodeProjectFileOptions = typeof opts === "string" ? { platform: opts } : opts;
  return {
    platform: o.platform ?? process.platform,
    pickedPaths: o.pickedPaths,
    isProjectPath: o.isProjectPath,
    readText: (p) => fsp.readFile(p, "utf8"),
    writeText: (p, contents) => fsp.writeFile(p, contents, "utf8"),
    copyFileExclusive: (src, dest) => fsp.copyFile(src, dest, constants.COPYFILE_EXCL),
    mkdirp: async (dir) => {
      await fsp.mkdir(dir, { recursive: true });
    },
    exists: async (p) => {
      try {
        await fsp.access(p);
        return true;
      } catch {
        return false;
      }
    },
    fileSize: async (p) => {
      try {
        const s = await fsp.stat(p);
        return s.isFile() ? s.size : null;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
  };
}
