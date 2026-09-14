import * as path from "node:path";
import { atomicWriteFile } from "./atomicWrite";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import { BACKUPS_DIR, resolveWithinSync } from "./paths";

/**
 * Autosave backups (ENGINEERING_SPEC §4): the last {@link MAX_BACKUPS}
 * autosaves live in `cache/backups/` as `autosave-<ms>.json`, where `<ms>` is
 * the injected clock's epoch-ms zero-padded so lexical order = time order.
 */

export const MAX_BACKUPS = 5;
const BACKUP_RE = /^autosave-(\d{15})\.json$/;

export interface BackupEntry {
  name: string;
  /** Epoch ms the autosave was taken (from the file name). */
  savedAtMs: number;
}

export const backupFileName = (ms: number): string =>
  `autosave-${String(Math.max(0, Math.floor(ms))).padStart(15, "0")}.json`;

export function parseBackupName(name: string): BackupEntry | null {
  const m = BACKUP_RE.exec(name);
  if (!m?.[1]) return null;
  return { name, savedAtMs: Number(m[1]) };
}

/** Backups for a project, newest first. Missing folder → []. */
export async function listBackups(fs: FsLike, projectDir: string): Promise<BackupEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(projectDir, BACKUPS_DIR));
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return [];
    throw e;
  }
  const entries: BackupEntry[] = [];
  for (const n of names) {
    const b = parseBackupName(n);
    if (b) entries.push(b);
  }
  return entries.sort((a, b) => b.savedAtMs - a.savedAtMs);
}

/**
 * Write an autosave backup at `nowMs` and prune to the newest `keep`. Two
 * saves in the same millisecond bump the stamp so neither is lost and ordering
 * stays strict. Returns the written entry.
 */
export async function writeBackup(
  fs: FsLike,
  projectDir: string,
  json: string,
  nowMs: number,
  keep = MAX_BACKUPS,
): Promise<BackupEntry> {
  const dir = path.join(projectDir, BACKUPS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const existing = await listBackups(fs, projectDir);
  const newest = existing[0]?.savedAtMs ?? -1;
  const stamp = Math.max(Math.floor(nowMs), newest + 1);
  const entry: BackupEntry = { name: backupFileName(stamp), savedAtMs: stamp };
  await atomicWriteFile(fs, path.join(dir, entry.name), json);
  await pruneBackups(fs, projectDir, keep);
  return entry;
}

/** Delete all but the newest `keep` backups. */
export async function pruneBackups(
  fs: FsLike,
  projectDir: string,
  keep = MAX_BACKUPS,
): Promise<void> {
  const all = await listBackups(fs, projectDir);
  for (const old of all.slice(Math.max(0, keep))) {
    await fs.rm(path.join(projectDir, BACKUPS_DIR, old.name), { force: true });
  }
}

/** Resolve a backup name from the renderer, rejecting anything that isn't a backup file. */
export function resolveBackupPath(projectDir: string, name: string): string {
  if (!parseBackupName(name)) {
    throw new FsIpcError("NO_BACKUP", `"${name}" is not an autosave backup`);
  }
  return resolveWithinSync(projectDir, path.join(BACKUPS_DIR, name));
}
