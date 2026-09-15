import type { Clip } from "../../model/schema";
import type { ProjectMeta } from "../../persistence";
import type { TranscribeRange } from "./types";

/**
 * Source ↔ timeline time mapping for host actions. Clips place source slices on
 * the timeline; speed regions live on timeline ms. Ramps are ignored here
 * (constant rate per region) — the whisper extractor only takes a flat rate.
 */

export interface SpeedLike {
  startMs: number;
  endMs: number;
  rate: number;
}

/** A transcribe range plus where it sits on the timeline. */
export interface MappedRange extends TranscribeRange {
  timelineStartMs: number;
}

/** Clips from meta, defaulting to one clip spanning the video (as the mapper does). */
export function effectiveClips(meta: Pick<ProjectMeta, "clips" | "sources"> | null): Clip[] {
  if (!meta) return [];
  if (meta.clips && meta.clips.length > 0) return meta.clips;
  const d = meta.sources.video.durationMs;
  return d > 0 ? [{ id: "clip-1", sourceStartMs: 0, sourceEndMs: d, timelineStartMs: 0 }] : [];
}

/**
 * The clips the timeline actually plays: the editor store's `clips` are the
 * source of truth (persistence writes them over `meta.clips`); meta is only the
 * fallback when the store has none (SPEC §4).
 */
export function timelineClips(
  storeClips: readonly Clip[],
  meta: Pick<ProjectMeta, "clips" | "sources"> | null,
): Clip[] {
  return storeClips.length > 0 ? [...storeClips] : effectiveClips(meta);
}

const clipLen = (c: Clip): number => c.sourceEndMs - c.sourceStartMs;

/**
 * Source-ms ranges (e.g. silence gaps in the mic, which is aligned with the
 * video source) → merged, sorted timeline ranges where that source is played.
 */
export function sourceRangesToTimeline(
  clips: readonly Clip[],
  ranges: readonly { startMs: number; endMs: number }[],
): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  for (const c of sortedClips(clips)) {
    for (const r of ranges) {
      if (!(Number.isFinite(r.startMs) && Number.isFinite(r.endMs))) continue;
      const s = Math.max(r.startMs, c.sourceStartMs);
      const e = Math.min(r.endMs, c.sourceEndMs);
      if (e <= s) continue;
      out.push({
        startMs: c.timelineStartMs + (s - c.sourceStartMs),
        endMs: c.timelineStartMs + (e - c.sourceStartMs),
      });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const r of out) {
    const last = merged.at(-1);
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
    else merged.push({ ...r });
  }
  return merged;
}

export function sortedClips(clips: readonly Clip[]): Clip[] {
  return clips.filter((c) => clipLen(c) > 0).sort((a, b) => a.timelineStartMs - b.timelineStartMs);
}

/** Timeline ms of a source ms, or null when that source time was trimmed away. */
export function sourceToTimelineMs(clips: readonly Clip[], sourceMs: number): number | null {
  for (const c of sortedClips(clips)) {
    if (sourceMs >= c.sourceStartMs && sourceMs < c.sourceEndMs) {
      return c.timelineStartMs + (sourceMs - c.sourceStartMs);
    }
  }
  return null;
}

/** First-wins, non-overlapping, valid speed regions sorted by start. */
function cleanSpeeds(speeds: readonly SpeedLike[]): SpeedLike[] {
  const valid = speeds
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: SpeedLike[] = [];
  let cursor = Number.NEGATIVE_INFINITY;
  for (const s of valid) {
    const start = Math.max(s.startMs, cursor);
    if (s.endMs <= start) continue;
    const rate = Number.isFinite(s.rate) && s.rate > 0 ? s.rate : 1;
    out.push({ startMs: start, endMs: s.endMs, rate });
    cursor = s.endMs;
  }
  return out;
}

/**
 * Source ranges to transcribe, in timeline order, split at speed-region edges
 * so each piece carries one rate. Concatenated at their rates they form the
 * exported audio, so whisper timestamps map back with {@link wavToTimelineMs}.
 */
export function deriveTranscribeRanges(
  clips: readonly Clip[],
  speeds: readonly SpeedLike[],
): MappedRange[] {
  const regions = cleanSpeeds(speeds);
  const out: MappedRange[] = [];
  for (const c of sortedClips(clips)) {
    const t0 = c.timelineStartMs;
    const t1 = t0 + clipLen(c);
    const cuts = new Set<number>([t0, t1]);
    for (const r of regions) {
      if (r.startMs > t0 && r.startMs < t1) cuts.add(r.startMs);
      if (r.endMs > t0 && r.endMs < t1) cuts.add(r.endMs);
    }
    const edges = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i] as number;
      const b = edges[i + 1] as number;
      if (b <= a) continue;
      const mid = (a + b) / 2;
      const rate = regions.find((r) => mid >= r.startMs && mid < r.endMs)?.rate ?? 1;
      const range: MappedRange = {
        startMs: c.sourceStartMs + (a - t0),
        endMs: c.sourceStartMs + (b - t0),
        timelineStartMs: a,
      };
      if (rate !== 1) range.rate = rate;
      out.push(range);
    }
  }
  return out;
}

/** Output (WAV) length of a range in ms. */
export function rangeOutputMs(r: TranscribeRange): number {
  return (r.endMs - r.startMs) / (r.rate ?? 1);
}

/** Whisper timestamp (ms into the extracted WAV) → timeline ms. */
export function wavToTimelineMs(ranges: readonly MappedRange[], wavMs: number): number {
  let acc = 0;
  let last: MappedRange | undefined;
  for (const r of ranges) {
    const len = rangeOutputMs(r);
    if (wavMs < acc + len) {
      return r.timelineStartMs + Math.max(0, wavMs - acc) * (r.rate ?? 1);
    }
    acc += len;
    last = r;
  }
  return last ? last.timelineStartMs + (last.endMs - last.startMs) : 0;
}

/** Strip the timeline field for the IPC request. */
export function toIpcRanges(ranges: readonly MappedRange[]): TranscribeRange[] {
  return ranges.map(({ startMs, endMs, rate }) =>
    rate === undefined ? { startMs, endMs } : { startMs, endMs, rate },
  );
}

/**
 * Cut source `ranges` out of the clips and ripple: remaining pieces are packed
 * back to back from the first clip's timeline start, in timeline order.
 */
export function removeSourceRanges(
  clips: readonly Clip[],
  ranges: readonly { startMs: number; endMs: number }[],
  newId: (base: Clip, index: number) => string = (base, i) =>
    i === 0 ? base.id : `${base.id}-${i}`,
): Clip[] {
  const cuts = ranges
    .filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const ordered = sortedClips(clips);
  const first = ordered[0];
  if (!first) return [];
  const pieces: Clip[] = [];
  for (const c of ordered) {
    let segs: [number, number][] = [[c.sourceStartMs, c.sourceEndMs]];
    for (const cut of cuts) {
      const next: [number, number][] = [];
      for (const [s, e] of segs) {
        if (cut.endMs <= s || cut.startMs >= e) {
          next.push([s, e]);
          continue;
        }
        if (cut.startMs > s) next.push([s, cut.startMs]);
        if (cut.endMs < e) next.push([cut.endMs, e]);
      }
      segs = next;
    }
    segs.forEach(([s, e], i) => {
      pieces.push({ id: newId(c, i), sourceStartMs: s, sourceEndMs: e, timelineStartMs: 0 });
    });
  }
  let t = first.timelineStartMs;
  return pieces.map((p) => {
    const placed = { ...p, timelineStartMs: t };
    t += p.sourceEndMs - p.sourceStartMs;
    return placed;
  });
}

/** Timeline end of the last clip. */
export function clipsEndMs(clips: readonly Clip[]): number {
  return clips.reduce((m, c) => Math.max(m, c.timelineStartMs + clipLen(c)), 0);
}
