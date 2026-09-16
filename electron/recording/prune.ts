/**
 * Auto-recording pruning (ENGINEERING_SPEC §5.6: "Auto-recordings older than
 * N days that were never opened are pruned … only if not attached to a
 * project"). Pure: the caller injects the listing of session dirs under
 * `<userData>/recordings`, an "imported" probe and the remover.
 */

export interface SessionDirInfo {
  path: string;
  mtimeMs: number;
}

export interface PruneDeps {
  listSessionDirs(): Promise<SessionDirInfo[]>;
  /** True when the dir is attached to a project and must be kept. */
  isImported(dir: string): Promise<boolean>;
  removeDir(dir: string): Promise<void>;
  now(): number;
  /** Dirs never touched (e.g. the live recording session). */
  skip?: ((dir: string) => boolean) | undefined;
  log?: ((message: string) => void) | undefined;
}

export const DAY_MS = 86_400_000;

/**
 * Delete session dirs older than `days` that are not attached to a project.
 * Returns the removed paths. One failing dir never stops the rest.
 */
export async function pruneRecordings(deps: PruneDeps, days: number): Promise<string[]> {
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoff = deps.now() - days * DAY_MS;
  let dirs: SessionDirInfo[];
  try {
    dirs = await deps.listSessionDirs();
  } catch (e) {
    deps.log?.(`prune: cannot list recordings (${e instanceof Error ? e.message : String(e)})`);
    return [];
  }
  const removed: string[] = [];
  for (const dir of dirs) {
    if (!Number.isFinite(dir.mtimeMs) || dir.mtimeMs >= cutoff) continue;
    if (deps.skip?.(dir.path)) continue;
    try {
      if (await deps.isImported(dir.path)) continue;
      await deps.removeDir(dir.path);
      removed.push(dir.path);
    } catch (e) {
      deps.log?.(`prune: skipped ${dir.path} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return removed;
}

/** Name of a project document; a session dir holding one is attached to a project. */
export const PROJECT_MARKER = "project.json";

/**
 * Decide from a dir listing whether a session dir is attached to a project.
 * A dir holding a project marker is kept. Everything else is prunable: the
 * leftovers after `project:create` moved the media out (empty or `meta.json`
 * only), and recordings that were never imported.
 */
export function isAttachedToProject(entries: readonly string[]): boolean {
  return entries.some((name) => name.toLowerCase() === PROJECT_MARKER);
}
