import * as path from "node:path";
import { atomicWriteFile } from "./atomicWrite";
import { listBackups, resolveBackupPath, writeBackup } from "./backups";
import type { MediaProbe, ProjectHandlers, ProjectListEntry, RecoveryInfo } from "./contracts";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import {
  CACHE_DIR,
  EXPORTS_DIR,
  MEDIA_DIR,
  PROJECT_EXT,
  PROJECT_FILE,
  THUMBNAIL_FILE,
  isWithin,
  pathExists,
  requireAbsolute,
  requireName,
  requireProjectPath,
  resolveWithin,
  uniqueName,
} from "./paths";
import type { RecentsStore } from "./recents";

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; issues?: unknown };

export interface ProjectDeps {
  fs: FsLike;
  /** Epoch ms. Every write stamps `modifiedAt` from this. */
  now: () => number;
  /** Absolute projects library folder (created on demand). */
  libraryRoot: () => Promise<string>;
  recents: RecentsStore;
  /** Validates a parsed project document (renderer schema + migrations live elsewhere). */
  validate: (doc: unknown) => ValidationResult | Promise<ValidationResult>;
  /** Move a path to the OS trash. */
  trashItem: (absPath: string) => Promise<void>;
  /** Read duration + video dimensions of a media file. */
  probe: (absPath: string) => Promise<MediaProbe>;
}

/** §9.9: relinked media must match the stored duration within ±1s. */
export const RELINK_DURATION_TOLERANCE_MS = 1000;

const iso = (ms: number): string => new Date(ms).toISOString();

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Shallow-merge `fields` into an object document; non-objects pass through (validator rejects them). */
export function stampDocument(doc: unknown, fields: Record<string, unknown>): unknown {
  return isPlainObject(doc) ? { ...doc, ...fields } : doc;
}

/** `modifiedAt` of a document as epoch ms, if present and parseable. */
export function documentModifiedMs(doc: unknown): number | null {
  if (!isPlainObject(doc) || typeof doc.modifiedAt !== "string") return null;
  const ms = Date.parse(doc.modifiedAt);
  return Number.isFinite(ms) ? ms : null;
}

export type RelinkMismatch =
  | { code: "RELINK_DURATION_MISMATCH"; expectedMs: number; actualMs: number }
  | {
      code: "RELINK_DIMENSION_MISMATCH";
      expected: { width: number | null; height: number | null };
      actual: { width: number | null; height: number | null };
    };

/** Pure relink validation (§9.9): duration within ±1s; dimensions exact when expected. */
export function checkRelink(
  expected: { durationMs: number; width?: number | undefined; height?: number | undefined },
  probe: MediaProbe,
): RelinkMismatch | null {
  if (
    !Number.isFinite(probe.durationMs) ||
    Math.abs(probe.durationMs - expected.durationMs) > RELINK_DURATION_TOLERANCE_MS
  ) {
    return {
      code: "RELINK_DURATION_MISMATCH",
      expectedMs: expected.durationMs,
      actualMs: probe.durationMs,
    };
  }
  const wBad = expected.width !== undefined && probe.width !== expected.width;
  const hBad = expected.height !== undefined && probe.height !== expected.height;
  if (wBad || hBad) {
    return {
      code: "RELINK_DIMENSION_MISMATCH",
      expected: { width: expected.width ?? null, height: expected.height ?? null },
      actual: { width: probe.width, height: probe.height },
    };
  }
  return null;
}

export function createProjectHandlers(deps: ProjectDeps): ProjectHandlers {
  const { fs } = deps;

  /**
   * Per-project write lock: overlapping saves/autosaves/restores on one folder
   * would otherwise share `project.json.tmp` and race backup stamps.
   */
  const locks = new Map<string, Promise<unknown>>();
  const withLock = <T>(dir: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(dir) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(dir, tail);
    void tail.then(() => {
      if (locks.get(dir) === tail) locks.delete(dir);
    });
    return run;
  };

  /** Recents are a convenience; a failure there must never fail (or roll back) a write. */
  const touchRecent = (dir: string): Promise<void> =>
    deps.recents.touch(dir).catch(() => undefined);

  const validated = async (doc: unknown): Promise<unknown> => {
    const res = await deps.validate(doc);
    if (!res.ok) {
      throw new FsIpcError("PROJECT_INVALID", res.message, res.issues);
    }
    return res.value;
  };

  const requireDir = async (dir: string): Promise<void> => {
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) return;
    } catch (e) {
      const code = errnoCode(e);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
    }
    throw new FsIpcError("PROJECT_NOT_FOUND", "Project folder not found", { path: dir });
  };

  const readJson = async (file: string): Promise<unknown> => {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (e) {
      const code = errnoCode(e);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
        throw new FsIpcError("PROJECT_NOT_FOUND", `${path.basename(file)} not found`, {
          path: file,
        });
      }
      throw e;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new FsIpcError("PROJECT_CORRUPT", `${path.basename(file)} is not valid JSON`, {
        path: file,
      });
    }
  };

  /** Stamp → validate → atomic write. */
  const writeProjectFile = async (
    dir: string,
    doc: unknown,
    extra: Record<string, unknown> = {},
  ): Promise<{ document: unknown; modifiedAt: string }> => {
    // Never stamp older than the newest autosave (same-ms bumps, clock stepped
    // back), or recovery would keep offering a backup the user just saved over.
    const newestBackup = (await listBackups(fs, dir))[0]?.savedAtMs ?? Number.NEGATIVE_INFINITY;
    const modifiedAt = iso(Math.max(deps.now(), newestBackup));
    const document = await validated(stampDocument(doc, { ...extra, modifiedAt }));
    await atomicWriteFile(
      fs,
      path.join(dir, PROJECT_FILE),
      `${JSON.stringify(document, null, 2)}\n`,
    );
    return { document, modifiedAt };
  };

  const recoveryFor = async (dir: string): Promise<RecoveryInfo | null> => {
    const backups = await listBackups(fs, dir);
    const newest = backups[0];
    if (!newest) return null;
    let projectMs: number | null = null;
    try {
      const doc = await readJson(path.join(dir, PROJECT_FILE));
      projectMs = documentModifiedMs(doc);
      if (projectMs === null) projectMs = (await fs.stat(path.join(dir, PROJECT_FILE))).mtimeMs;
    } catch (e) {
      if (!(e instanceof FsIpcError)) throw e;
    }
    if (projectMs !== null && newest.savedAtMs <= projectMs) return null;
    return {
      backupName: newest.name,
      backupSavedAt: iso(newest.savedAtMs),
      projectModifiedAt: projectMs === null ? null : iso(projectMs),
      backups: backups.map((b) => ({ name: b.name, savedAt: iso(b.savedAtMs) })),
    };
  };

  const freeDirName = (parent: string, name: string): Promise<string> =>
    uniqueName(`${name}${PROJECT_EXT}`, (c) => pathExists(fs, path.join(parent, c)));

  /** Create `<parent>/<name>.reelform` (uniquified) with its standard subfolders. */
  const makeProjectDir = async (parent: string, rawName: string): Promise<string> => {
    const name = requireName(rawName);
    await fs.mkdir(parent, { recursive: true });
    const dir = path.join(parent, await freeDirName(parent, name));
    try {
      await fs.mkdir(dir);
    } catch (e) {
      if (errnoCode(e) === "EEXIST") {
        throw new FsIpcError("PROJECT_EXISTS", "A project with that name already exists", {
          path: dir,
        });
      }
      throw e;
    }
    for (const sub of [MEDIA_DIR, CACHE_DIR, EXPORTS_DIR]) {
      await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
    return dir;
  };

  const cleanup = (dir: string) =>
    fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);

  const toPosix = (p: string): string => p.split(path.sep).join("/");

  const summarize = async (dir: string, recent: boolean): Promise<ProjectListEntry> => {
    const fallbackName = path.basename(dir, path.extname(dir));
    const base: ProjectListEntry = {
      path: dir,
      name: fallbackName,
      modifiedAt: null,
      thumbnailPath: null,
      missing: false,
      corrupt: false,
      recent,
    };
    if (!(await pathExists(fs, dir))) return { ...base, missing: true };
    const thumb = path.join(dir, THUMBNAIL_FILE);
    const thumbnailPath = (await pathExists(fs, thumb)) ? thumb : null;
    try {
      const doc = await readJson(path.join(dir, PROJECT_FILE));
      const ms = documentModifiedMs(doc);
      const name = isPlainObject(doc) && typeof doc.name === "string" ? doc.name : fallbackName;
      return { ...base, name, thumbnailPath, modifiedAt: ms === null ? null : iso(ms) };
    } catch (e) {
      if (!(e instanceof FsIpcError)) throw e;
      return { ...base, thumbnailPath, corrupt: true };
    }
  };

  return {
    "project:create": async (req) => {
      const parent = req.parentDir ? requireAbsolute(req.parentDir) : await deps.libraryRoot();
      const media = req.media ?? [];
      for (const m of media) requireAbsolute(m.sourcePath);
      const dir = await makeProjectDir(parent, req.name);
      const mediaFiles: string[] = [];
      let written: { document: unknown; modifiedAt: string };
      try {
        for (const m of media) {
          const name = await uniqueName(requireName(m.fileName), (c) =>
            pathExists(fs, path.join(dir, MEDIA_DIR, c)),
          );
          const dest = await resolveWithin(fs, dir, path.join(MEDIA_DIR, name));
          await fs.copyFile(m.sourcePath, dest);
          mediaFiles.push(name);
        }
        written = await writeProjectFile(dir, req.document);
      } catch (e) {
        await cleanup(dir);
        throw e;
      }
      // Past this point the project is on disk and must never be rolled back:
      // sources are removed only now, and nothing after can throw.
      for (const m of media) {
        if (m.move) await fs.rm(m.sourcePath, { force: true }).catch(() => undefined);
      }
      await touchRecent(dir);
      return { path: dir, ...written, mediaFiles };
    },

    "project:open": async (req) => {
      const dir = requireProjectPath(req.path);
      await requireDir(dir);
      const document = await validated(await readJson(path.join(dir, PROJECT_FILE)));
      await touchRecent(dir);
      const ms = documentModifiedMs(document);
      return {
        path: dir,
        document,
        modifiedAt: ms === null ? null : iso(ms),
        recovery: await recoveryFor(dir),
      };
    },

    "project:save": async (req) => {
      const dir = requireProjectPath(req.path);
      await requireDir(dir);
      return withLock(dir, async () => {
        if (req.autosave) {
          const nowMs = deps.now();
          const modifiedAt = iso(nowMs);
          const document = await validated(stampDocument(req.document, { modifiedAt }));
          const entry = await writeBackup(fs, dir, JSON.stringify(document), nowMs);
          return { path: dir, modifiedAt, backupName: entry.name };
        }
        const { modifiedAt } = await writeProjectFile(dir, req.document);
        return { path: dir, modifiedAt, backupName: null };
      });
    },

    "project:saveAs": async (req) => {
      const src = requireProjectPath(req.path);
      await requireDir(src);
      const parent = req.parentDir ? requireAbsolute(req.parentDir) : path.dirname(src);
      if (isWithin(src, parent)) {
        throw new FsIpcError("INVALID_PATH", "Cannot save a project inside itself", {
          path: parent,
        });
      }
      const dir = await makeProjectDir(parent, req.name);
      try {
        const srcMedia = path.join(src, MEDIA_DIR);
        if (await pathExists(fs, srcMedia)) {
          await fs.cp(srcMedia, path.join(dir, MEDIA_DIR), { recursive: true });
        }
        const thumb = path.join(src, THUMBNAIL_FILE);
        if (await pathExists(fs, thumb)) await fs.copyFile(thumb, path.join(dir, THUMBNAIL_FILE));
        const extra =
          isPlainObject(req.document) && "name" in req.document ? { name: req.name } : {};
        const { document, modifiedAt } = await writeProjectFile(dir, req.document, extra);
        await touchRecent(dir);
        return { path: dir, document, modifiedAt };
      } catch (e) {
        await cleanup(dir);
        throw e;
      }
    },

    "project:list": async () => {
      const root = await deps.libraryRoot();
      const libraryDirs: string[] = [];
      try {
        for (const ent of await fs.readdir(root, { withFileTypes: true })) {
          if (ent.isDirectory() && path.extname(ent.name).toLowerCase() === PROJECT_EXT) {
            libraryDirs.push(path.join(root, ent.name));
          }
        }
      } catch (e) {
        const code = errnoCode(e);
        if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
      }
      const recents = new Set((await deps.recents.list()).map((p) => path.resolve(p)));
      const all = new Set([...libraryDirs, ...recents]);
      const projects: ProjectListEntry[] = [];
      for (const dir of all) projects.push(await summarize(dir, recents.has(dir)));
      projects.sort((a, b) => {
        if (a.modifiedAt === b.modifiedAt) return a.name.localeCompare(b.name);
        if (a.modifiedAt === null) return 1;
        if (b.modifiedAt === null) return -1;
        return a.modifiedAt < b.modifiedAt ? 1 : -1;
      });
      return { projects };
    },

    "project:trash": async (req) => {
      const dir = requireProjectPath(req.path);
      await requireDir(dir);
      // Only ever trash something that is really a project folder.
      if (!(await pathExists(fs, path.join(dir, PROJECT_FILE)))) {
        throw new FsIpcError("PROJECT_NOT_FOUND", "Not a Reelform project folder", { path: dir });
      }
      try {
        await deps.trashItem(dir);
      } catch (e) {
        throw new FsIpcError("TRASH_FAILED", "Could not move the project to the trash", {
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      // Already in the trash: a recents hiccup must not report the trash as failed.
      await deps.recents.remove(dir).catch(() => undefined);
      return { trashed: true as const };
    },

    "project:recovery": async (req) => {
      const dir = requireProjectPath(req.path);
      await requireDir(dir);
      return { recovery: await recoveryFor(dir) };
    },

    "project:restore": async (req) => {
      const dir = requireProjectPath(req.path);
      await requireDir(dir);
      return withLock(dir, async () => {
        const name = req.backupName ?? (await listBackups(fs, dir))[0]?.name;
        if (name === undefined) throw new FsIpcError("NO_BACKUP", "No autosave to restore");
        const backupPath = resolveBackupPath(dir, name);
        let doc: unknown;
        try {
          doc = await readJson(backupPath);
        } catch (e) {
          if (e instanceof FsIpcError && e.code === "PROJECT_NOT_FOUND") {
            throw new FsIpcError("NO_BACKUP", `Backup "${name}" not found`);
          }
          throw e;
        }
        const { document, modifiedAt } = await writeProjectFile(dir, doc);
        return { path: dir, document, modifiedAt, restoredFrom: name };
      });
    },

    "project:relink": async (req) => {
      const dir = requireProjectPath(req.path);
      await requireDir(dir);
      const file = requireAbsolute(req.filePath);
      try {
        if (!(await fs.stat(file)).isFile()) throw new Error("not a file");
      } catch {
        throw new FsIpcError("RELINK_FILE_NOT_FOUND", "The selected file does not exist", {
          path: file,
        });
      }
      let probe: MediaProbe;
      try {
        probe = await deps.probe(file);
      } catch (e) {
        throw new FsIpcError("RELINK_PROBE_FAILED", "Could not read the selected media file", {
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      const mismatch = checkRelink(req.expected, probe);
      if (mismatch) {
        const { code, ...details } = mismatch;
        const msg =
          code === "RELINK_DURATION_MISMATCH"
            ? "The file's duration doesn't match the original"
            : "The file's dimensions don't match the original";
        throw new FsIpcError(code, msg, details);
      }
      if (req.mode === "reference") return { path: file, probe };
      if (isWithin(dir, file)) return { path: toPosix(path.relative(dir, file)), probe };
      await fs.mkdir(path.join(dir, MEDIA_DIR), { recursive: true });
      const name = await uniqueName(requireName(path.basename(file)), (c) =>
        pathExists(fs, path.join(dir, MEDIA_DIR, c)),
      );
      const dest = await resolveWithin(fs, dir, path.join(MEDIA_DIR, name));
      await fs.copyFile(file, dest);
      return { path: `${MEDIA_DIR}/${name}`, probe };
    },
  };
}
