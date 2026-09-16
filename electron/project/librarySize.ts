import * as path from "node:path";
import type { FsLike } from "./fsTypes";

/**
 * On-disk size of project folders for the library list (guide S04/S23 Size
 * column and footer total). A full walk is cached per folder and reused while
 * the folder's cheap fingerprint — the mtimes of the folder, its direct
 * subfolders and project.json — is unchanged, so repeated `project:list` calls
 * (tray refresh, launcher reloads) cost a handful of stats per project.
 */

export interface FolderSizeCache {
  /** Total bytes of regular files under `dir` (symlinks skipped); null when unreadable. */
  sizeOf(dir: string): Promise<number | null>;
}

async function fingerprint(fs: FsLike, dir: string): Promise<string> {
  const parts = [`${(await fs.stat(dir)).mtimeMs}`];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory() || ent.name === "project.json") {
      try {
        const st = await fs.stat(path.join(dir, ent.name));
        parts.push(`${ent.name}:${st.mtimeMs}:${st.size}`);
      } catch {
        // Vanished between readdir and stat; the walk below settles it.
      }
    }
  }
  return parts.join("|");
}

async function walk(fs: FsLike, dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (ent) => {
      const abs = path.join(dir, ent.name);
      try {
        if (ent.isSymbolicLink()) return 0;
        if (ent.isDirectory()) return await walk(fs, abs);
        if (ent.isFile()) return (await fs.stat(abs)).size;
      } catch {
        // A nested entry that disappears or can't be read doesn't sink the total.
      }
      return 0;
    }),
  );
  return sizes.reduce((sum, n) => sum + n, 0);
}

export function createFolderSizeCache(fs: FsLike): FolderSizeCache {
  const cache = new Map<string, { key: string; bytes: number }>();
  return {
    async sizeOf(dir) {
      try {
        const key = await fingerprint(fs, dir);
        const hit = cache.get(dir);
        if (hit && hit.key === key) return hit.bytes;
        const bytes = await walk(fs, dir);
        cache.set(dir, { key, bytes });
        return bytes;
      } catch {
        cache.delete(dir);
        return null;
      }
    },
  };
}
