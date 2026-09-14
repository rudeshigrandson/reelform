import { snapToFrame } from "@shared/time";

/**
 * Deterministic playback clock (ENGINEERING_SPEC §6.2 / §6.3).
 *
 * Pure: given the previous playhead and the wall-clock time elapsed since the
 * last frame, produce the next playhead. Speed regions scale how fast timeline
 * time advances (a 2× region consumes timeline ms twice as fast as wall ms).
 */

/**
 * Timeline rate at a timeline time. When `nextBoundary` is present the clock
 * steps exactly from rate change to rate change; otherwise it integrates in
 * small fixed sub-steps (≤ {@link FALLBACK_STEP_MS} of timeline time).
 */
export interface RateFn {
  (tMs: number): number;
  /** First timeline time strictly after `tMs` where the rate may change. */
  nextBoundary?: ((tMs: number) => number) | undefined;
}

export interface ClockState {
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  loop: boolean;
}

export interface ClockResult {
  currentMs: number;
  isPlaying: boolean;
}

export interface RateRegion {
  startMs: number;
  endMs: number;
  rate: number;
}

/** Timeline sub-step used when the rate function exposes no boundaries. */
export const FALLBACK_STEP_MS = 0.5;
/** Safety valve for pathological inputs (e.g. huge elapsed on a tiny looping timeline). */
const MAX_ITERATIONS = 100_000;

const constantRate: RateFn = () => 1;

/** Clamp a time into `[0, durationMs]`; non-finite input maps to 0. */
export function clampTime(ms: number, durationMs: number): number {
  const d = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (!Number.isFinite(ms)) return 0;
  return Math.min(d, Math.max(0, ms));
}

const safeRate = (r: number): number => (Number.isFinite(r) && r > 0 ? r : 1);

/**
 * Advance the playhead by `elapsedWallMs` of wall-clock time. Paused, negative,
 * zero or NaN elapsed → no-op (playhead only clamped). At the end: `loop` wraps
 * to 0 carrying the remaining wall time; otherwise stops at `durationMs`.
 */
export function advance(
  state: ClockState,
  elapsedWallMs: number,
  rateAt: RateFn = constantRate,
): ClockResult {
  const durationMs = Number.isFinite(state.durationMs) ? Math.max(0, state.durationMs) : 0;
  let t = clampTime(state.currentMs, durationMs);
  if (!state.isPlaying) return { currentMs: t, isPlaying: false };
  if (durationMs <= 0) return { currentMs: 0, isPlaying: false };
  if (!Number.isFinite(elapsedWallMs) || elapsedWallMs <= 0) {
    return { currentMs: t, isPlaying: true };
  }

  let wall = elapsedWallMs;
  for (let i = 0; wall > 0 && i < MAX_ITERATIONS; i++) {
    const rate = safeRate(rateAt(t));
    let boundary = rateAt.nextBoundary ? rateAt.nextBoundary(t) : t + FALLBACK_STEP_MS;
    if (!(boundary > t)) boundary = t + FALLBACK_STEP_MS;
    boundary = Math.min(boundary, durationMs);

    const wallNeeded = (boundary - t) / rate;
    if (wallNeeded >= wall) {
      t = Math.min(durationMs, t + wall * rate);
      wall = 0;
    } else {
      t = boundary;
      wall -= wallNeeded;
    }

    if (t >= durationMs) {
      if (!state.loop) return { currentMs: durationMs, isPlaying: false };
      t = 0;
    }
  }
  return { currentMs: t, isPlaying: true };
}

/**
 * Rate function from speed regions: rate inside `[startMs, endMs)`, 1 outside.
 * Overlaps resolve to the first matching region. Exposes `nextBoundary` so the
 * clock crosses region edges exactly.
 */
export function rateAtFromRegions(regions: readonly RateRegion[]): RateFn {
  const valid = regions.filter(
    (r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs,
  );
  const edges = [...new Set(valid.flatMap((r) => [r.startMs, r.endMs]))].sort((a, b) => a - b);
  const fn: RateFn = (tMs) => {
    for (const r of valid) {
      if (tMs >= r.startMs && tMs < r.endMs) return safeRate(r.rate);
    }
    return 1;
  };
  fn.nextBoundary = (tMs) => {
    for (const e of edges) if (e > tMs) return e;
    return Number.POSITIVE_INFINITY;
  };
  return fn;
}

/** Multiply a rate function by a constant, preserving its boundaries. */
export function scaleRate(rateAt: RateFn, factor: number): RateFn {
  if (factor === 1) return rateAt;
  const fn: RateFn = (tMs) => safeRate(rateAt(tMs)) * factor;
  fn.nextBoundary = rateAt.nextBoundary;
  return fn;
}

const FRAME_EPSILON = 1e-6;

/**
 * Step `n` frames from `currentMs`, landing on a frame boundary. From an
 * off-frame time, +1 goes to the next boundary and −1 to the previous one.
 * The result is clamped to `[0, durationMs]`.
 */
export function stepFrames(currentMs: number, n: number, fps: number, durationMs: number): number {
  const start = clampTime(currentMs, durationMs);
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(n)) return start;
  const steps = Math.trunc(n);
  const frameFloat = (start / 1000) * fps;
  let frame: number;
  if (steps > 0) frame = Math.floor(frameFloat + FRAME_EPSILON) + steps;
  else if (steps < 0) frame = Math.ceil(frameFloat - FRAME_EPSILON) + steps;
  else frame = Math.round(frameFloat);
  return clampTime(snapToFrame((frame / fps) * 1000, fps), durationMs);
}

/** Step `n` whole seconds, clamped to `[0, durationMs]`. */
export function stepSeconds(currentMs: number, n: number, durationMs: number): number {
  if (!Number.isFinite(n)) return clampTime(currentMs, durationMs);
  return clampTime(clampTime(currentMs, durationMs) + n * 1000, durationMs);
}
