// Cursor path smoothing & resampling — ENGINEERING_SPEC §6.6.
//
// Pipeline:
//   1. Resample the raw telemetry to a fixed 240 Hz grid using Catmull-Rom
//      spline interpolation (endpoints clamped/duplicated).
//   2. Smooth the resampled x and y channels with a one-euro filter. The
//      "Snappy⟷Silky" knob (0..1) maps to the filter's minimum cutoff:
//      5 Hz at snappy (0) down to 0.5 Hz at silky (1).
//
// Everything here is pure and deterministic (no Date.now / Math.random).

import type { OneEuroConfig } from "./oneEuro.js";
import { OneEuroFilter } from "./oneEuro.js";

/** A single raw telemetry cursor sample. x,y are normalized to 0..1. */
export interface CursorPoint {
  /** Timestamp in milliseconds. */
  readonly tMs: number;
  /** Normalized x position, 0..1. */
  readonly x: number;
  /** Normalized y position, 0..1. */
  readonly y: number;
  /** Optional cursor type (arrow, ibeam, hand, grab, resize-*). */
  readonly cursorType?: string;
}

/** A resampled + smoothed cursor sample on the 240 Hz grid. */
export interface SmoothedCursorSample {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
  /** Cursor type carried from the nearest source sample (if any). */
  readonly cursorType?: string;
}

/** The target resampling rate in Hz, per §6.6. */
export const RESAMPLE_HZ = 240;

/** Sampling period of the resampled track, in milliseconds. */
export const RESAMPLE_PERIOD_MS = 1000 / RESAMPLE_HZ;

/** Min cutoff (Hz) at the "snappy" end of the knob (knob = 0). */
const SNAPPY_MIN_CUTOFF_HZ = 5;
/** Min cutoff (Hz) at the "silky" end of the knob (knob = 1). */
const SILKY_MIN_CUTOFF_HZ = 0.5;

/** Options controlling the smoothing pass. */
export interface CursorSmoothingOptions {
  /**
   * "Snappy⟷Silky" knob, 0..1. 0 = snappy (min-cutoff 5 Hz, low lag),
   * 1 = silky (min-cutoff 0.5 Hz, heavy smoothing). Clamped to [0,1].
   */
  readonly smoothing?: number;
  /** One-euro beta (speed coefficient). Defaults to a mild value. */
  readonly beta?: number;
  /** One-euro derivative cutoff (Hz). Defaults to 1 Hz. */
  readonly dCutoff?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Map the 0..1 "Snappy⟷Silky" knob to a one-euro minimum cutoff in Hz.
 * Linear interpolation from 5 Hz (snappy) to 0.5 Hz (silky).
 */
export function knobToMinCutoff(smoothing: number): number {
  const s = clamp(smoothing, 0, 1);
  return SNAPPY_MIN_CUTOFF_HZ + (SILKY_MIN_CUTOFF_HZ - SNAPPY_MIN_CUTOFF_HZ) * s;
}

/**
 * Catmull-Rom spline interpolation for one scalar channel.
 * p1 and p2 are the segment endpoints; p0 and p3 are the neighbours used to
 * derive tangents. `u` is the segment parameter in [0,1].
 * Uses the standard uniform (Catmull-Rom) basis.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/**
 * Sort points by time and drop non-finite / duplicate-timestamp samples.
 * Keeps the first sample seen for any given timestamp. Returns a new array.
 */
function sanitize(points: readonly CursorPoint[]): CursorPoint[] {
  const valid = points.filter(
    (p) => Number.isFinite(p.tMs) && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const sorted = [...valid].sort((a, b) => a.tMs - b.tMs);
  const out: CursorPoint[] = [];
  let lastT = Number.NEGATIVE_INFINITY;
  for (const p of sorted) {
    if (p.tMs === lastT) continue;
    out.push(p);
    lastT = p.tMs;
  }
  return out;
}

/**
 * Find the index of the segment containing time `tMs` and return it plus the
 * neighbour indices with endpoint clamping. The segment is [i, i+1].
 */
function segmentFor(pts: readonly CursorPoint[], tMs: number): { i: number; u: number } {
  const n = pts.length;
  // Locate i such that pts[i].tMs <= tMs < pts[i+1].tMs. Binary search.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // mid is in [1, n-1]; noUncheckedIndexedAccess: guard the access.
    const p = pts[mid];
    if (p !== undefined && p.tMs <= tMs) lo = mid;
    else hi = mid - 1;
  }
  const i = clamp(lo, 0, n - 2);
  const a = pts[i];
  const b = pts[i + 1];
  if (a === undefined || b === undefined) return { i, u: 0 };
  const span = b.tMs - a.tMs;
  const u = span > 0 ? clamp((tMs - a.tMs) / span, 0, 1) : 0;
  return { i, u };
}

/** Interpolate raw (unsmoothed) position at time `tMs` via Catmull-Rom. */
function interpolateRaw(pts: readonly CursorPoint[], tMs: number): { x: number; y: number } {
  const n = pts.length;
  const first = pts[0];
  const last = pts[n - 1];
  if (first === undefined || last === undefined) return { x: 0, y: 0 };
  if (n === 1) return { x: first.x, y: first.y };
  if (tMs <= first.tMs) return { x: first.x, y: first.y };
  if (tMs >= last.tMs) return { x: last.x, y: last.y };

  const { i, u } = segmentFor(pts, tMs);
  // Clamp neighbour indices (duplicate first/last points at the ends).
  const p0 = pts[i - 1] ?? pts[i];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[i + 2] ?? pts[i + 1];
  if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
    return { x: first.x, y: first.y };
  }
  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, u),
    y: catmullRom(p0.y, p1.y, p2.y, p3.y, u),
  };
}

/** Nearest source cursorType for a given time (carried onto resampled samples). */
function nearestCursorType(pts: readonly CursorPoint[], tMs: number): string | undefined {
  let best: CursorPoint | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of pts) {
    const d = Math.abs(p.tMs - tMs);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best?.cursorType;
}

/**
 * A resampled + smoothed cursor track with random-access position lookup.
 * Immutable; build it once via {@link buildSmoothedCursorTrack}.
 */
export class SmoothedCursorTrack {
  /** The 240 Hz resampled + smoothed samples, ascending in time. */
  readonly samples: readonly SmoothedCursorSample[];
  private readonly startMs: number;
  private readonly endMs: number;

  constructor(samples: readonly SmoothedCursorSample[]) {
    this.samples = samples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    this.startMs = first?.tMs ?? 0;
    this.endMs = last?.tMs ?? 0;
  }

  /** Time of the first sample (ms). */
  get startTimeMs(): number {
    return this.startMs;
  }

  /** Time of the last sample (ms). */
  get endTimeMs(): number {
    return this.endMs;
  }

  /**
   * Smoothed cursor position at an arbitrary time `tMs`, clamped to the
   * sampled range. Linearly interpolates between the two nearest 240 Hz
   * samples (the underlying signal is already smoothed, so linear is fine).
   */
  positionAt(tMs: number): { x: number; y: number } {
    const n = this.samples.length;
    const first = this.samples[0];
    const last = this.samples[n - 1];
    if (first === undefined || last === undefined) return { x: 0, y: 0 };
    if (tMs <= this.startMs) return { x: first.x, y: first.y };
    if (tMs >= this.endMs) return { x: last.x, y: last.y };

    // Uniform grid → direct index from time offset.
    const rel = (tMs - this.startMs) / RESAMPLE_PERIOD_MS;
    const i = Math.floor(rel);
    const u = rel - i;
    const a = this.samples[i];
    const b = this.samples[i + 1];
    if (a === undefined) return { x: last.x, y: last.y };
    if (b === undefined) return { x: a.x, y: a.y };
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    };
  }
}

/**
 * Build the full resampled (240 Hz) + one-euro-smoothed cursor track from raw
 * telemetry points. Returns a {@link SmoothedCursorTrack} exposing both the
 * sample array and {@link SmoothedCursorTrack.positionAt}.
 *
 * Deterministic and pure.
 */
export function buildSmoothedCursorTrack(
  points: readonly CursorPoint[],
  options: CursorSmoothingOptions = {},
): SmoothedCursorTrack {
  const pts = sanitize(points);
  const n = pts.length;
  if (n === 0) return new SmoothedCursorTrack([]);

  const first = pts[0];
  const last = pts[n - 1];
  if (first === undefined || last === undefined) return new SmoothedCursorTrack([]);

  // Single point (or zero-duration): emit exactly that one sample.
  if (n === 1 || last.tMs <= first.tMs) {
    const only: SmoothedCursorSample =
      first.cursorType !== undefined
        ? { tMs: first.tMs, x: first.x, y: first.y, cursorType: first.cursorType }
        : { tMs: first.tMs, x: first.x, y: first.y };
    return new SmoothedCursorTrack([only]);
  }

  // 1) Resample onto the 240 Hz grid using Catmull-Rom interpolation.
  const startMs = first.tMs;
  const endMs = last.tMs;
  const count = Math.max(1, Math.round((endMs - startMs) / RESAMPLE_PERIOD_MS) + 1);

  const config: OneEuroConfig = {
    minCutoff: knobToMinCutoff(options.smoothing ?? 0.5),
    beta: options.beta ?? 0.5,
    dCutoff: options.dCutoff ?? 1,
  };
  const fx = new OneEuroFilter(config);
  const fy = new OneEuroFilter(config);

  const out: SmoothedCursorSample[] = new Array<SmoothedCursorSample>(count);
  for (let k = 0; k < count; k++) {
    const tMs = k === count - 1 ? endMs : startMs + k * RESAMPLE_PERIOD_MS;
    const raw = interpolateRaw(pts, tMs);

    // 2) Smooth each channel with the one-euro filter (time in seconds).
    const tSec = tMs / 1000;
    const x = clamp(fx.filter(tSec, raw.x), 0, 1);
    const y = clamp(fy.filter(tSec, raw.y), 0, 1);

    const cursorType = nearestCursorType(pts, tMs);
    out[k] = cursorType !== undefined ? { tMs, x, y, cursorType } : { tMs, x, y };
  }

  return new SmoothedCursorTrack(out);
}

/**
 * Convenience: return just the resampled + smoothed 240 Hz sample array.
 */
export function resampleAndSmooth(
  points: readonly CursorPoint[],
  options: CursorSmoothingOptions = {},
): readonly SmoothedCursorSample[] {
  return buildSmoothedCursorTrack(points, options).samples;
}
