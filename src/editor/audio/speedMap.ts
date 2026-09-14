import type { Clip } from "../model/schema";

/**
 * Speed-region time mapping for audio (ENGINEERING_SPEC §9.5 / §10.5).
 *
 * Speed regions live on *timeline* ms (same axis as the playback clock, clips,
 * audio regions and clicks). A rate r means timeline time advances r× faster
 * than output (wall/export) time. Ramps change the rate linearly (in timeline
 * time) from 1 → rate over `rampInMs` and rate → 1 over `rampOutMs`, so output
 * time u(t) = ∫ dt / rate(t) has a closed form and a closed-form inverse.
 */

export interface AudioSpeedRegion {
  startMs: number;
  endMs: number;
  rate: number;
  rampInMs?: number | undefined;
  rampOutMs?: number | undefined;
}

/** Rate varies linearly from r0 at t0 to r1 at t1 (timeline ms). */
export interface RatePiece {
  t0: number;
  t1: number;
  r0: number;
  r1: number;
  /** Output time at t0. */
  u0: number;
  /** Output time at t1. */
  u1: number;
}

const safeRate = (r: number): number => (Number.isFinite(r) && r > 0 ? r : 1);

/** Output-time length of a piece prefix of `dt` timeline ms. */
function pieceOutput(p: Pick<RatePiece, "t0" | "t1" | "r0" | "r1">, dt: number): number {
  if (p.r0 === p.r1 || p.t1 === p.t0) return dt / p.r0;
  const b = (p.r1 - p.r0) / (p.t1 - p.t0);
  return Math.log((p.r0 + b * dt) / p.r0) / b;
}

function pieceInverse(p: RatePiece, du: number): number {
  if (p.r0 === p.r1 || p.t1 === p.t0) return p.t0 + du * p.r0;
  const b = (p.r1 - p.r0) / (p.t1 - p.t0);
  return p.t0 + (p.r0 * Math.expm1(b * du)) / b;
}

export class SpeedMap {
  /** Non-1× pieces, sorted and non-overlapping. Gaps between them run at 1×. */
  readonly pieces: readonly RatePiece[];

  constructor(regions: readonly AudioSpeedRegion[]) {
    const valid = regions
      .filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs)
      .sort((a, b) => a.startMs - b.startMs);
    const raw: Array<Omit<RatePiece, "u0" | "u1">> = [];
    let cursor = Number.NEGATIVE_INFINITY;
    for (const r of valid) {
      const start = Math.max(r.startMs, cursor);
      if (r.endMs <= start) continue; // fully overlapped by an earlier region
      const rate = safeRate(r.rate);
      const dur = r.endMs - start;
      let ri = Math.max(0, Number.isFinite(r.rampInMs) ? (r.rampInMs as number) : 0);
      let ro = Math.max(0, Number.isFinite(r.rampOutMs) ? (r.rampOutMs as number) : 0);
      if (ri + ro > dur) {
        const s = dur / (ri + ro);
        ri *= s;
        ro *= s;
      }
      if (ri > 0) raw.push({ t0: start, t1: start + ri, r0: 1, r1: rate });
      if (dur - ri - ro > 0) raw.push({ t0: start + ri, t1: r.endMs - ro, r0: rate, r1: rate });
      if (ro > 0) raw.push({ t0: r.endMs - ro, t1: r.endMs, r0: rate, r1: 1 });
      cursor = r.endMs;
    }
    const pieces: RatePiece[] = [];
    let t = 0;
    let u = 0;
    for (const p of raw) {
      u += p.t0 - t; // 1× gap before this piece (timeline starts at 0)
      const len = pieceOutput(p, p.t1 - p.t0);
      pieces.push({ ...p, u0: u, u1: u + len });
      u += len;
      t = p.t1;
    }
    this.pieces = pieces;
  }

  /** Instantaneous rate at timeline time `tMs`. */
  rateAt(tMs: number): number {
    for (const p of this.pieces) {
      if (tMs >= p.t0 && tMs < p.t1) {
        return p.t1 === p.t0 ? p.r0 : p.r0 + ((p.r1 - p.r0) * (tMs - p.t0)) / (p.t1 - p.t0);
      }
    }
    return 1;
  }

  /** Timeline ms → output ms (monotonic). */
  timelineToOutput(tMs: number): number {
    let lastT = 0;
    let lastU = 0;
    for (const p of this.pieces) {
      if (tMs < p.t0) break;
      if (tMs < p.t1) return p.u0 + pieceOutput(p, tMs - p.t0);
      lastT = p.t1;
      lastU = p.u1;
    }
    return lastU + (tMs - lastT);
  }

  /** Output ms → timeline ms (inverse of {@link timelineToOutput}). */
  outputToTimeline(uMs: number): number {
    let lastT = 0;
    let lastU = 0;
    for (const p of this.pieces) {
      if (uMs < p.u0) break;
      if (uMs < p.u1) return pieceInverse(p, uMs - p.u0);
      lastT = p.t1;
      lastU = p.u1;
    }
    return lastT + (uMs - lastU);
  }
}

/** A constant-rate slice of a recorded source placed in output time. */
export interface SourceSegment {
  clipId: string;
  outputStartMs: number;
  outputEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  /** playbackRate = source ms per output ms. */
  rate: number;
}

/**
 * Split clips × speed pieces into constant-rate segments for BufferSource
 * scheduling. Ramp pieces are subdivided into steps of ≤ `rampStepMs` timeline
 * ms, each played at its average rate (exact start/end alignment preserved).
 */
export function sourceSegments(
  clips: readonly Clip[],
  map: SpeedMap,
  rampStepMs = 20,
): SourceSegment[] {
  const cuts = new Set<number>();
  for (const p of map.pieces) {
    cuts.add(p.t0);
    cuts.add(p.t1);
    if (p.r0 !== p.r1) {
      const n = Math.max(1, Math.ceil((p.t1 - p.t0) / Math.max(1e-3, rampStepMs)));
      for (let i = 1; i < n; i++) cuts.add(p.t0 + ((p.t1 - p.t0) * i) / n);
    }
  }
  const out: SourceSegment[] = [];
  for (const c of clips) {
    const cStart = c.timelineStartMs;
    const cEnd = cStart + (c.sourceEndMs - c.sourceStartMs);
    if (!(cEnd > cStart)) continue;
    const edges = [cStart, cEnd, ...[...cuts].filter((x) => x > cStart && x < cEnd)].sort(
      (a, b) => a - b,
    );
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i] as number;
      const b = edges[i + 1] as number;
      if (!(b > a)) continue;
      const u0 = map.timelineToOutput(a);
      const u1 = map.timelineToOutput(b);
      out.push({
        clipId: c.id,
        outputStartMs: u0,
        outputEndMs: u1,
        sourceStartMs: c.sourceStartMs + (a - cStart),
        sourceEndMs: c.sourceStartMs + (b - cStart),
        rate: u1 > u0 ? (b - a) / (u1 - u0) : 1,
      });
    }
  }
  return out.sort((x, y) => x.outputStartMs - y.outputStartMs);
}
