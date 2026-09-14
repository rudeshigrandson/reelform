/**
 * Stage 1 — Normalize & clean (ENGINEERING_SPEC §8.1).
 * Drop cursor points outside 0..1, resample to a fixed 60Hz grid, and compute
 * per-sample speed in units/second.
 */

import { inUnit } from "./util.js";
import type { TelemetryPoint } from "./types.js";

export const SAMPLE_HZ = 60;
export const SAMPLE_DT_MS = 1000 / SAMPLE_HZ;

/** A resampled cursor sample on the 60Hz grid. */
export interface Sample {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
  /** speed in units/second at this sample (0 for the first sample). */
  readonly speed: number;
}

/**
 * Resample raw cursor points onto a uniform 60Hz grid via linear interpolation,
 * then compute speed. Points outside the unit square are dropped before
 * interpolation. Returns [] if fewer than 2 valid points remain.
 */
export function resample(points: readonly TelemetryPoint[]): Sample[] {
  const clean: { t: number; x: number; y: number }[] = [];
  for (const p of points) {
    const t = p[0];
    const x = p[1];
    const y = p[2];
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!inUnit(x) || !inUnit(y)) continue;
    clean.push({ t, x, y });
  }
  clean.sort((a, b) => a.t - b.t);
  if (clean.length < 2) return [];

  const first = clean[0];
  const last = clean[clean.length - 1];
  // Both are defined because length >= 2, but guard for strict indexing.
  if (first === undefined || last === undefined) return [];

  const startT = first.t;
  const endT = last.t;
  const out: Sample[] = [];
  let seg = 0;

  let prev: { x: number; y: number } | undefined;
  for (let t = startT; t <= endT + 1e-6; t += SAMPLE_DT_MS) {
    // advance segment so that clean[seg].t <= t <= clean[seg+1].t
    while (seg < clean.length - 2) {
      const nextPt = clean[seg + 1];
      if (nextPt !== undefined && nextPt.t < t) seg++;
      else break;
    }
    const a = clean[seg];
    const b = clean[seg + 1] ?? a;
    if (a === undefined || b === undefined) break;
    const span = b.t - a.t;
    const frac = span > 0 ? clamp01((t - a.t) / span) : 0;
    const x = a.x + (b.x - a.x) * frac;
    const y = a.y + (b.y - a.y) * frac;

    let speed = 0;
    if (prev !== undefined) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      speed = d / (SAMPLE_DT_MS / 1000);
    }
    out.push({ tMs: t, x, y, speed });
    prev = { x, y };
  }
  return out;
}

/** Nearest resampled cursor position at time `tMs`. Returns undefined if empty. */
export function cursorAt(
  samples: readonly Sample[],
  tMs: number,
): { x: number; y: number } | undefined {
  if (samples.length === 0) return undefined;
  // binary search for nearest
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const s = samples[mid];
    if (s === undefined) break;
    if (s.tMs < tMs) lo = mid + 1;
    else hi = mid;
  }
  const cand = samples[lo];
  const prev = lo > 0 ? samples[lo - 1] : undefined;
  if (cand === undefined) return prev ? { x: prev.x, y: prev.y } : undefined;
  if (prev === undefined) return { x: cand.x, y: cand.y };
  const dCand = Math.abs(cand.tMs - tMs);
  const dPrev = Math.abs(prev.tMs - tMs);
  const chosen = dPrev < dCand ? prev : cand;
  return { x: chosen.x, y: chosen.y };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
