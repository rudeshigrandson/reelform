import { clamp } from "../controls";
import {
  type CursorSample,
  DEFAULT_IDLE_PARAMS,
  EFFECTS_LIMITS,
  type IdleParams,
  type SilenceParams,
  type SilencePreview,
  type SpeedRegionEdit,
  type TimeRange,
} from "./types";

/**
 * Pure effects logic: silence detection, idle detection, speed-region edits.
 * Deterministic so preview and export agree.
 */

/** Linear RMS amplitude (0..1) → dBFS. Zero/negative maps to -Infinity. */
export function amplitudeToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

/**
 * Silent gaps in a dB envelope. Window `i` covers `[i, i+1) / sampleRateHz` s.
 * A window is silent when its level is ≤ threshold (NaN counts as not silent).
 * Result is sorted, non-overlapping, each gap ≥ `minSilenceMs`.
 */
export function detectSilentGaps(
  envelopeDb: readonly number[],
  sampleRateHz: number,
  params: SilenceParams,
): TimeRange[] {
  if (!(sampleRateHz > 0) || !Number.isFinite(sampleRateHz)) return [];
  const windowMs = 1000 / sampleRateHz;
  const minMs = Math.max(0, params.minSilenceMs);
  const gaps: TimeRange[] = [];
  let runStart = -1;
  const close = (endIdx: number) => {
    if (runStart < 0) return;
    const startMs = runStart * windowMs;
    const endMs = endIdx * windowMs;
    if (endMs - startMs >= minMs && endMs > startMs) gaps.push({ startMs, endMs });
    runStart = -1;
  };
  for (let i = 0; i < envelopeDb.length; i++) {
    const db = envelopeDb[i] as number;
    const silent = db <= params.thresholdDb;
    if (silent) {
      if (runStart < 0) runStart = i;
    } else {
      close(i);
    }
  }
  close(envelopeDb.length);
  return gaps;
}

export function summarizeGaps(gaps: readonly TimeRange[]): SilencePreview {
  return { count: gaps.length, totalMs: gaps.reduce((s, g) => s + (g.endMs - g.startMs), 0) };
}

/** "00:18" — whole seconds, rounded; minutes grow past 99 as needed. */
export function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "Would remove 12 gaps (00:18 total)". */
export function formatSilencePreview({ count, totalMs }: SilencePreview): string {
  if (count === 0) return "No silent gaps found";
  return `Would remove ${count} ${count === 1 ? "gap" : "gaps"} (${formatMmSs(totalMs)} total)`;
}

/**
 * Idle sections: runs where consecutive cursor samples move ≤ `epsilon` and no
 * click occurs, lasting ≥ `minIdleMs`. Sorted, non-overlapping.
 */
export function detectIdleSections(
  samples: readonly CursorSample[],
  params: Pick<IdleParams, "minIdleMs" | "epsilon"> = DEFAULT_IDLE_PARAMS,
): TimeRange[] {
  const pts = [...samples].filter((p) => Number.isFinite(p.tMs)).sort((a, b) => a.tMs - b.tMs);
  const out: TimeRange[] = [];
  if (pts.length < 2) return out;
  let s = 0;
  const close = (endIdx: number) => {
    const startMs = (pts[s] as CursorSample).tMs;
    const endMs = (pts[endIdx] as CursorSample).tMs;
    if (endMs > startMs && endMs - startMs >= params.minIdleMs) out.push({ startMs, endMs });
  };
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1] as CursorSample;
    const cur = pts[i] as CursorSample;
    const moved = Math.hypot(cur.x - prev.x, cur.y - prev.y) > params.epsilon;
    if (moved || cur.click === true) {
      close(i - 1);
      s = i;
    }
  }
  close(pts.length - 1);
  return out;
}

/** Suggested speed regions for idle sections (§9.5: 3× with 300ms ramps). */
export function suggestIdleSpeedRegions(
  sections: readonly TimeRange[],
  params: IdleParams = DEFAULT_IDLE_PARAMS,
  makeId: (index: number, range: TimeRange) => string = (i, r) =>
    `idle-${i}-${Math.round(r.startMs)}`,
): SpeedRegionEdit[] {
  return sections.map((r, i) =>
    normalizeSpeedRegion({
      id: makeId(i, r),
      startMs: r.startMs,
      endMs: r.endMs,
      rate: params.rate,
      keepPitch: true,
      rampInMs: params.rampMs,
      rampOutMs: params.rampMs,
    }),
  );
}

/** Clamp a playback rate to 0.25–8×; non-finite → 1×. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return clamp(rate, EFFECTS_LIMITS.speedRate.min, EFFECTS_LIMITS.speedRate.max);
}

/** Longest allowed ramp: half the region. */
export function maxRampMs(region: Pick<SpeedRegionEdit, "startMs" | "endMs">): number {
  return Math.max(0, (region.endMs - region.startMs) / 2);
}

function clampRamp(ms: number, max: number): number {
  return Number.isFinite(ms) ? clamp(ms, 0, max) : 0;
}

/** Enforce rate bounds and ramps ≤ half the region. */
export function normalizeSpeedRegion(region: SpeedRegionEdit): SpeedRegionEdit {
  const max = maxRampMs(region);
  return {
    ...region,
    rate: clampRate(region.rate),
    rampInMs: clampRamp(region.rampInMs, max),
    rampOutMs: clampRamp(region.rampOutMs, max),
  };
}

export function updateSpeedRegion(
  region: SpeedRegionEdit,
  patch: Partial<Pick<SpeedRegionEdit, "rate" | "keepPitch" | "rampInMs" | "rampOutMs">>,
): SpeedRegionEdit {
  return normalizeSpeedRegion({ ...region, ...patch });
}
