import type { Clip } from "../editor/model/schema";

/**
 * Timeline-time ↔ source-time mapping (see ENGINEERING_SPEC §4/§6).
 *
 * Timeline time is measured in milliseconds *after* trims. Clips are a
 * contiguous, ordered sequence: each occupies `[timelineStartMs, timelineStartMs
 * + (sourceEndMs - sourceStartMs))` on the timeline and maps linearly back into
 * its source range. Speed regions are handled by the timeline/export layers on
 * top of this base mapping; kept pure and deterministic for export parity.
 */

const clipDurationMs = (c: Clip): number => c.sourceEndMs - c.sourceStartMs;

/** Total timeline duration implied by the clip sequence. */
export function timelineDurationMs(clips: readonly Clip[]): number {
  return clips.reduce((sum, c) => sum + clipDurationMs(c), 0);
}

/**
 * Map a timeline time to a source time. Returns `null` when `tMs` falls outside
 * every clip (e.g. past the end). Clip boundaries are half-open: the end of one
 * clip is the start of the next.
 */
export function timelineToSource(
  clips: readonly Clip[],
  tMs: number,
): { clipId: string; sourceMs: number } | null {
  if (tMs < 0) return null;
  for (const c of clips) {
    const start = c.timelineStartMs;
    const end = start + clipDurationMs(c);
    if (tMs >= start && tMs < end) {
      return { clipId: c.id, sourceMs: c.sourceStartMs + (tMs - start) };
    }
  }
  return null;
}

/** Inverse: map a source time within a specific clip back to timeline time. */
export function sourceToTimeline(clip: Clip, sourceMs: number): number | null {
  if (sourceMs < clip.sourceStartMs || sourceMs > clip.sourceEndMs) return null;
  return clip.timelineStartMs + (sourceMs - clip.sourceStartMs);
}

/** Round a time to the nearest whole frame boundary for a given fps. */
export function snapToFrame(tMs: number, fps: number): number {
  const frame = Math.round((tMs / 1000) * fps);
  return (frame / fps) * 1000;
}
