/**
 * Recording policy rules (ENGINEERING_SPEC §5.6) as pure functions: disk
 * thresholds, max length, recorded duration with pauses, auto-prune.
 */

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Preparing refuses to start with less free space than this. */
export const MIN_FREE_BYTES_TO_START = 2 * GIB;
/** Below this while recording the session is interrupted (data kept). */
export const INTERRUPT_FREE_BYTES = 500 * MIB;

export const DEFAULT_MAX_LENGTH_MS = 3 * 60 * 60 * 1000;
export const DEFAULT_PRUNE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DiskStatus = "ok" | "low" | "critical";

/** `ok` ≥ 2GB, `low` (warn) ≥ 500MB, `critical` (interrupt) below. Unknown/NaN counts as ok. */
export function diskStatus(freeBytes: number): DiskStatus {
  if (!Number.isFinite(freeBytes)) return "ok";
  if (freeBytes < INTERRUPT_FREE_BYTES) return "critical";
  if (freeBytes < MIN_FREE_BYTES_TO_START) return "low";
  return "ok";
}

export function canStartWithFreeBytes(freeBytes: number): boolean {
  return diskStatus(freeBytes) === "ok";
}

/** Setting value → effective max length; invalid / non-positive falls back to the default. */
export function effectiveMaxLengthMs(setting: number | null | undefined): number {
  return typeof setting === "number" && Number.isFinite(setting) && setting > 0
    ? setting
    : DEFAULT_MAX_LENGTH_MS;
}

export function maxLengthReached(recordedMs: number, maxLengthMs: number): boolean {
  return recordedMs >= effectiveMaxLengthMs(maxLengthMs);
}

export interface PausedRange {
  startMs: number;
  /** `null` while the pause is still open. */
  endMs: number | null;
}

/**
 * Recorded (non-paused) time between `startMs` and `nowMs`. Pauses are clipped
 * to the recording window; an open pause runs until `nowMs`. Never negative.
 */
export function recordedDurationMs(
  startMs: number,
  nowMs: number,
  paused: readonly PausedRange[],
): number {
  if (!(nowMs > startMs)) return 0;
  let pausedMs = 0;
  for (const p of paused) {
    const s = Math.max(startMs, p.startMs);
    const e = Math.min(nowMs, p.endMs ?? nowMs);
    if (e > s) pausedMs += e - s;
  }
  return Math.max(0, nowMs - startMs - pausedMs);
}

export interface RecordingEntry {
  id: string;
  createdAtMs: number;
  /** Last time it was opened in the editor; `null` = never opened. */
  openedAtMs: number | null;
  attachedToProject: boolean;
}

/**
 * Ids of auto-recordings to prune: older than `days` days, never opened and not
 * attached to a project. `days <= 0` / non-finite disables pruning.
 */
export function selectRecordingsToPrune(
  entries: readonly RecordingEntry[],
  nowMs: number,
  days: number,
): string[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoff = nowMs - days * DAY_MS;
  return entries
    .filter((e) => e.openedAtMs === null && !e.attachedToProject && e.createdAtMs < cutoff)
    .map((e) => e.id);
}
