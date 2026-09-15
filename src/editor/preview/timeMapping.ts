import { timelineToSource } from "@shared/time";
import type { Clip } from "../model/schema";
import type { RateRegion } from "../playback/clock";

/**
 * Timeline → source mapping for the preview (ENGINEERING_SPEC §6.3). Clips
 * remove trimmed ranges; speed regions change the media element's
 * `playbackRate`. Pure: the preview <video> sync and the scene evaluation
 * (cursor telemetry lives in source time) share these functions, and export
 * uses the same `timelineToSource`.
 */

export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 8;

export interface SourceTime {
  /** Clip id, or null when no clips exist (identity mapping). */
  clipId: string | null;
  sourceMs: number;
}

/** A speed region as the preview needs it (`keepPitch` defaults to true). */
export interface SpeedLike extends RateRegion {
  keepPitch?: boolean | undefined;
}

/**
 * Source time for a timeline time. No clips → identity (a fresh recording
 * whose document has not been trimmed). Returns null outside every clip.
 */
export function mapTimelineToSource(
  clips: readonly Clip[] | null | undefined,
  tMs: number,
): SourceTime | null {
  if (!Number.isFinite(tMs) || tMs < 0) return null;
  if (!clips || clips.length === 0) return { clipId: null, sourceMs: tMs };
  return timelineToSource(clips, tMs);
}

/**
 * Total-function variant for per-frame evaluation (cursor, click effects): a
 * time past the last clip clamps to that clip's end, before the first to 0.
 */
export function sourceTimeAt(clips: readonly Clip[] | null | undefined, tMs: number): number {
  const t = Number.isFinite(tMs) ? Math.max(0, tMs) : 0;
  const mapped = mapTimelineToSource(clips, t);
  if (mapped) return mapped.sourceMs;
  if (!clips || clips.length === 0) return t;
  let last: Clip | null = null;
  for (const c of clips) {
    if (last === null || c.timelineStartMs >= last.timelineStartMs) last = c;
  }
  return last ? last.sourceEndMs : t;
}

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
}

/** The speed region containing `tMs` (half-open), latest start wins. */
export function speedRegionAt<S extends SpeedLike>(speeds: readonly S[], tMs: number): S | null {
  let best: S | null = null;
  for (const s of speeds) {
    if (!(s.endMs > s.startMs) || tMs < s.startMs || tMs >= s.endMs) continue;
    if (best === null || s.startMs >= best.startMs) best = s;
  }
  return best;
}

/** Media playback rate at `tMs`: speed region × shuttle, clamped to 0.25–8. */
export function playbackRateAt(speeds: readonly SpeedLike[], tMs: number, shuttle = 1): number {
  const region = speedRegionAt(speeds, tMs);
  const base = region ? region.rate : 1;
  const k = Number.isFinite(shuttle) && shuttle > 0 ? shuttle : 1;
  return clampPlaybackRate(base * k);
}

/** `preservesPitch` for the media element at `tMs` (true outside regions). */
export function preservesPitchAt(speeds: readonly SpeedLike[], tMs: number): boolean {
  return speedRegionAt(speeds, tMs)?.keepPitch ?? true;
}
