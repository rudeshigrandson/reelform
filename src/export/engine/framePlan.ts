import { timelineToSource } from "@shared/time";
import type { Clip } from "../../editor/model/schema";
import { type RateRegion, rateAtFromRegions } from "../../editor/playback/clock";

/**
 * Export frame plan (ENGINEERING_SPEC §10.2 / §10.3).
 *
 * Output frame `i` sits at output time `outputMs = i * 1000 / fps`. Speed
 * regions (timeline ms, post-trim) compress or stretch the output: a 2× region
 * of 1000 timeline ms occupies 500 output ms. Each output frame is mapped back
 * to a timeline time (where the scene is evaluated, identical to preview) and
 * from there to a source time via `timelineToSource`. The decoder then picks
 * the source frame nearest that time, so rates < 1 naturally repeat frames and
 * rates > 1 skip them (no interpolation in 1.0).
 *
 * Pure and deterministic; frames are computed on demand so long exports never
 * materialise the whole plan.
 */

/** Keyframe interval in seconds (§10.3). */
export const KEYFRAME_INTERVAL_S = 2;

/** Numerical guard so float noise never produces a spurious extra frame. */
const FRAME_EPS = 1e-6;

export interface FramePlanInput {
  clips: readonly Clip[];
  speeds?: readonly RateRegion[] | undefined;
  fps: number;
  /** Timeline range to export (ms). Defaults to the whole clip sequence. */
  range?: { startMs: number; endMs: number } | undefined;
  /** Nominal source frame rate; enables `sourceFrameMs` snapping. */
  sourceFps?: number | undefined;
}

export interface PlannedFrame {
  index: number;
  /** Output presentation time (ms). */
  outputMs: number;
  /** Encoder timestamp in microseconds, derived from `outputMs`. */
  timestampUs: number;
  /** Encoder frame duration in microseconds. */
  durationUs: number;
  /** Timeline time at which the scene is evaluated. */
  timelineMs: number;
  clipId: string | null;
  /** Exact source time, or null when the timeline time maps to no clip. */
  sourceMs: number | null;
  /** `sourceMs` snapped to the nearest nominal source frame inside the clip. */
  sourceFrameMs: number | null;
  keyFrame: boolean;
}

export interface FramePlan {
  fps: number;
  totalFrames: number;
  outputDurationMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  frameAt(index: number): PlannedFrame;
  frames(): IterableIterator<PlannedFrame>;
}

interface Segment {
  startMs: number;
  endMs: number;
  rate: number;
  outStartMs: number;
}

/** Number of output frames between keyframes (≥ 1). */
export function keyFrameInterval(fps: number): number {
  return Math.max(1, Math.round(KEYFRAME_INTERVAL_S * fps));
}

function buildSegments(startMs: number, endMs: number, speeds: readonly RateRegion[]): Segment[] {
  const rateAt = rateAtFromRegions(speeds);
  const edges = new Set<number>([startMs, endMs]);
  for (const r of speeds) {
    if (r.startMs > startMs && r.startMs < endMs) edges.add(r.startMs);
    if (r.endMs > startMs && r.endMs < endMs) edges.add(r.endMs);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const segments: Segment[] = [];
  let out = 0;
  for (let k = 0; k + 1 < sorted.length; k++) {
    const a = sorted[k] as number;
    const b = sorted[k + 1] as number;
    const rate = rateAt(a);
    segments.push({ startMs: a, endMs: b, rate, outStartMs: out });
    out += (b - a) / rate;
  }
  return segments;
}

function snapSourceFrame(sourceMs: number, clip: Clip, sourceFps: number): number {
  const step = 1000 / sourceFps;
  let snapped = Math.round(sourceMs / step) * step;
  if (snapped >= clip.sourceEndMs)
    snapped = Math.ceil(clip.sourceEndMs / step - 1 - FRAME_EPS) * step;
  if (snapped < clip.sourceStartMs)
    snapped = Math.ceil(clip.sourceStartMs / step - FRAME_EPS) * step;
  // Clips shorter than one source frame: fall back to the exact time.
  return snapped >= clip.sourceStartMs && snapped < clip.sourceEndMs ? snapped : sourceMs;
}

export function createFramePlan(input: FramePlanInput): FramePlan {
  const { fps } = input;
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`invalid fps: ${fps}`);
  const clipEnd = input.clips.reduce(
    (m, c) => Math.max(m, c.timelineStartMs + (c.sourceEndMs - c.sourceStartMs)),
    0,
  );
  const rangeStartMs = Math.max(0, input.range?.startMs ?? 0);
  const rangeEndMs = Math.max(rangeStartMs, input.range?.endMs ?? clipEnd);
  const speeds = input.speeds ?? [];
  const segments = buildSegments(rangeStartMs, rangeEndMs, speeds);
  const last = segments[segments.length - 1];
  const outputDurationMs = last ? last.outStartMs + (last.endMs - last.startMs) / last.rate : 0;
  const totalFrames =
    outputDurationMs > 0 ? Math.max(0, Math.ceil((outputDurationMs * fps) / 1000 - FRAME_EPS)) : 0;
  const clipsById = new Map(input.clips.map((c) => [c.id, c]));
  const sourceFps =
    input.sourceFps !== undefined && Number.isFinite(input.sourceFps) && input.sourceFps > 0
      ? input.sourceFps
      : null;
  const kfEvery = keyFrameInterval(fps);
  const durationUs = Math.round(1_000_000 / fps);

  function segmentFor(outMs: number): Segment | undefined {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((segments[mid] as Segment).outStartMs <= outMs) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo];
  }

  function frameAt(index: number): PlannedFrame {
    if (!Number.isInteger(index) || index < 0 || index >= totalFrames) {
      throw new RangeError(`frame index ${index} outside [0, ${totalFrames})`);
    }
    const outputMs = (index * 1000) / fps;
    const seg = segmentFor(outputMs) as Segment;
    const raw = seg.startMs + (outputMs - seg.outStartMs) * seg.rate;
    const timelineMs = Math.max(rangeStartMs, Math.min(raw, rangeEndMs - FRAME_EPS));
    const src = timelineToSource(input.clips, timelineMs);
    const clip = src ? clipsById.get(src.clipId) : undefined;
    const sourceFrameMs =
      src && clip && sourceFps !== null ? snapSourceFrame(src.sourceMs, clip, sourceFps) : null;
    return {
      index,
      outputMs,
      timestampUs: Math.round(outputMs * 1000),
      durationUs,
      timelineMs,
      clipId: src?.clipId ?? null,
      sourceMs: src?.sourceMs ?? null,
      sourceFrameMs,
      keyFrame: index % kfEvery === 0,
    };
  }

  return {
    fps,
    totalFrames,
    outputDurationMs,
    rangeStartMs,
    rangeEndMs,
    frameAt,
    *frames() {
      for (let i = 0; i < totalFrames; i++) yield frameAt(i);
    },
  };
}
