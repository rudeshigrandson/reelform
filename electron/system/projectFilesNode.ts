import { constants } from "node:fs";
import * as fsp from "node:fs/promises";
import type { ProjectFileDeps } from "./projectFiles";

/** Node file-system deps for {@link createProjectFileHandlers} (no Electron). */
export function createNodeProjectFileDeps(platform: string = process.platform): ProjectFileDeps {
  return {
    platform,
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
