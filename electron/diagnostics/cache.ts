import * as nodePath from "node:path";

/**
 * "Clear cache" beyond Chromium's HTTP cache (§13: clearing must fully remove
 * regenerable data). Walks each project's `cache/` for known regenerable
 * entries plus any extra app cache folders. `cache/backups` (autosave
 * recovery) is only touched when explicitly requested; anything else in
 * `cache/` (e.g. the trash marker) is never touched.
 */

export interface CacheDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface CacheFs {
  readdir(dir: string, opts: { withFileTypes: true }): Promise<CacheDirent[]>;
  lstat(p: string): Promise<{
    size: number;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>;
  rm(p: string, opts: { recursive: true; force: true }): Promise<void>;
}

export const PROJECT_CACHE_DIR = "cache";
export const BACKUPS_ENTRY = "backups";

/** Regenerable entries directly under `<project>/cache/`. */
export const REGENERABLE_CACHE_ENTRIES: readonly string[] = [
  "thumbnails",
  "thumbs",
  "waveforms",
  "proxy",
  "proxy.mp4",
  "proxy.partial.mp4",
  "autozoom",
  "filmstrip",
];

export interface CacheTargets {
  /** Absolute `.reelform` folders. */
  projectDirs: readonly string[];
  /** Absolute app-level cache folders whose contents are all regenerable. */
  extraCacheDirs?: readonly string[] | undefined;
}

export interface CacheBreakdown {
  projectsBytes: number;
  extraBytes: number;
}

export interface ClearCacheResult {
  removedBytes: number;
  /** Paths that could not be removed. */
  failed: string[];
}

const isMissing = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export function createCacheOps(fs: CacheFs, path: Pick<typeof nodePath, "join"> = nodePath) {
  /** Bytes under `p` without following symlinks (a link counts as its own size). */
  const sizeOf = async (p: string): Promise<number> => {
    let st: Awaited<ReturnType<CacheFs["lstat"]>>;
    try {
      st = await fs.lstat(p);
    } catch (e) {
      if (isMissing(e)) return 0;
      throw e;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) return st.size;
    let total = 0;
    for (const ent of await fs.readdir(p, { withFileTypes: true }).catch(() => [])) {
      total += await sizeOf(path.join(p, ent.name)).catch(() => 0);
    }
    return total;
  };

  const childrenOf = async (dir: string): Promise<string[]> => {
    try {
      return (await fs.readdir(dir, { withFileTypes: true })).map((e) => path.join(dir, e.name));
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
  };

  const projectEntries = (dir: string, includeBackups: boolean): string[] => {
    const names = includeBackups
      ? [...REGENERABLE_CACHE_ENTRIES, BACKUPS_ENTRY]
      : REGENERABLE_CACHE_ENTRIES;
    return names.map((n) => path.join(dir, PROJECT_CACHE_DIR, n));
  };

  const entries = async (
    targets: CacheTargets,
    includeBackups: boolean,
  ): Promise<{ project: string[]; extra: string[] }> => {
    const project = [...new Set(targets.projectDirs)].flatMap((d) =>
      projectEntries(d, includeBackups),
    );
    const extra: string[] = [];
    for (const d of new Set(targets.extraCacheDirs ?? [])) {
      extra.push(...(await childrenOf(d).catch(() => [])));
    }
    return { project, extra };
  };

  const sumAll = async (paths: readonly string[]): Promise<number> => {
    let total = 0;
    for (const p of paths) total += await sizeOf(p).catch(() => 0);
    return total;
  };

  return {
    /** Regenerable bytes (backups excluded). */
    async sumCache(targets: CacheTargets): Promise<CacheBreakdown> {
      const { project, extra } = await entries(targets, false);
      return { projectsBytes: await sumAll(project), extraBytes: await sumAll(extra) };
    },

    async clearCache(
      targets: CacheTargets,
      opts: { includeBackups?: boolean | undefined } = {},
    ): Promise<ClearCacheResult> {
      const { project, extra } = await entries(targets, opts.includeBackups ?? false);
      const result: ClearCacheResult = { removedBytes: 0, failed: [] };
      for (const p of [...project, ...extra]) {
        const size = await sizeOf(p).catch(() => 0);
        try {
          await fs.rm(p, { recursive: true, force: true });
          result.removedBytes += size;
        } catch {
          result.failed.push(p);
        }
      }
      return result;
    },
  };
}

export type CacheOps = ReturnType<typeof createCacheOps>;
