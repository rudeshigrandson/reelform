/**
 * Stages 4–7 — Regionize, level, focus, easing (ENGINEERING_SPEC §8.4-8.7).
 * Turns scored survivors into non-overlapping zoom regions with focus, level,
 * and easing timings.
 */

import { clamp, dist } from "./util.js";
import type { CandidateKind } from "./candidates.js";
import type { ScoredCandidate } from "./score.js";

const REGION_PRE_MS = 400;
const REGION_POST_MS = 1800;
const MERGE_FOCUS_UNITS = 0.15;
const MERGE_GAP_MS = 700;
const CLUSTER_TAIL_MS = 900;
const REGION_CAP_MS = 12_000;
const MIN_REGION_GAP_MS = 1200;

const TIGHT_SPREAD = 0.12;
const WIDE_SPREAD = 0.35;
const FOLLOW_SPREAD = 0.2;

const LEVEL_TIGHT = 2.2;
const LEVEL_WIDE = 1.5;
const LEVEL_MIN = 1.3;
const LEVEL_MAX = 2.6;

/** An intermediate merged cluster before finalization. */
export interface Region {
  startMs: number;
  endMs: number;
  /** members contributing focus/level. */
  members: ScoredCandidate[];
  /** weighted centroid focus. */
  fx: number;
  fy: number;
}

function candidateEnd(c: ScoredCandidate): number {
  return c.endMs !== undefined ? c.endMs : c.tMs;
}

function centroid(members: readonly ScoredCandidate[]): { x: number; y: number } {
  let wsum = 0;
  let x = 0;
  let y = 0;
  for (const m of members) {
    const w = m.score > 0 ? m.score : 1e-3;
    x += m.x * w;
    y += m.y * w;
    wsum += w;
  }
  if (wsum === 0) return { x: 0.5, y: 0.5 };
  return { x: x / wsum, y: y / wsum };
}

/** Build raw regions and merge nearby ones (focus <0.15 units & gap <700ms). */
export function buildRegions(survivors: readonly ScoredCandidate[]): Region[] {
  const sorted = survivors.slice().sort((a, b) => a.tMs - b.tMs);
  const regions: Region[] = [];

  for (const c of sorted) {
    const start = c.tMs - REGION_PRE_MS;
    const end = candidateEnd(c) + REGION_POST_MS;
    const prev = regions[regions.length - 1];
    if (prev !== undefined) {
      const gap = start - prev.endMs;
      const focusClose = dist(prev.fx, prev.fy, c.x, c.y) <= MERGE_FOCUS_UNITS;
      if (focusClose && gap < MERGE_GAP_MS) {
        prev.members.push(c);
        // extend end to last activity in cluster + tail
        prev.endMs = Math.max(prev.endMs, candidateEnd(c) + CLUSTER_TAIL_MS);
        const ctr = centroid(prev.members);
        prev.fx = ctr.x;
        prev.fy = ctr.y;
        continue;
      }
    }
    regions.push({ startMs: start, endMs: end, members: [c], fx: c.x, fy: c.y });
  }

  // cap length
  for (const r of regions) {
    if (r.endMs - r.startMs > REGION_CAP_MS) r.endMs = r.startMs + REGION_CAP_MS;
  }

  // enforce min gap: merge with weighted focus if too close
  return enforceMinGap(regions);
}

function enforceMinGap(regions: readonly Region[]): Region[] {
  const out: Region[] = [];
  for (const r of regions) {
    const prev = out[out.length - 1];
    if (prev !== undefined && r.startMs - prev.endMs < MIN_REGION_GAP_MS) {
      prev.members.push(...r.members);
      prev.endMs = Math.max(prev.endMs, r.endMs);
      const ctr = centroid(prev.members);
      prev.fx = ctr.x;
      prev.fy = ctr.y;
      if (prev.endMs - prev.startMs > REGION_CAP_MS) {
        prev.endMs = prev.startMs + REGION_CAP_MS;
      }
      continue;
    }
    out.push({ ...r, members: r.members.slice() });
  }
  return out;
}

/** Spatial spread (max pairwise distance of members from centroid). */
export function spread(region: Region): number {
  const ctr = centroid(region.members);
  let max = 0;
  for (const m of region.members) {
    const d = dist(ctr.x, ctr.y, m.x, m.y);
    if (d > max) max = d;
  }
  return max;
}

/** Stage 5 — zoom level from cluster tightness, clamped, sensitivity-nudged. */
export function levelFor(region: Region, sensitivity: number): number {
  const s = spread(region);
  let level: number;
  if (s <= TIGHT_SPREAD) {
    level = LEVEL_TIGHT;
  } else if (s >= WIDE_SPREAD) {
    level = LEVEL_WIDE;
  } else {
    const t = (s - TIGHT_SPREAD) / (WIDE_SPREAD - TIGHT_SPREAD);
    level = LEVEL_TIGHT + (LEVEL_WIDE - LEVEL_TIGHT) * t;
  }
  // sensitivity nudge ±0.3 around 0.5
  const clampedSens = sensitivity < 0 ? 0 : sensitivity > 1 ? 1 : sensitivity;
  level += (clampedSens - 0.5) * 0.6; // ±0.3
  return clamp(level, LEVEL_MIN, LEVEL_MAX);
}

export interface RegionFocus {
  readonly mode: "fixed" | "follow";
  readonly x: number;
  readonly y: number;
}

/** Stage 6 — focus mode: follow when enabled AND spread > 0.2, else fixed. */
export function focusFor(region: Region, followCursor: boolean): RegionFocus {
  const ctr = centroid(region.members);
  const useFollow = followCursor && spread(region) > FOLLOW_SPREAD;
  return {
    mode: useFollow ? "follow" : "fixed",
    x: clamp(ctr.x, 0, 1),
    y: clamp(ctr.y, 0, 1),
  };
}

export interface Easing {
  readonly easeInMs: number;
  readonly easeOutMs: number;
}

/** Stage 7 — easing timings; shorter for regions under 2s. */
export function easingFor(region: Region): Easing {
  const durMs = region.endMs - region.startMs;
  if (durMs < 2000) return { easeInMs: 400, easeOutMs: 500 };
  return { easeInMs: 600, easeOutMs: 700 };
}

/** Human-readable reason from the dominant candidate kinds in a region. */
export function reasonFor(region: Region): string {
  const counts = new Map<CandidateKind, number>();
  for (const m of region.members) {
    counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  }
  const parts: string[] = [];
  const order: CandidateKind[] = ["click", "typing", "selection", "scroll", "dwell"];
  for (const kind of order) {
    const n = counts.get(kind);
    if (n === undefined || n === 0) continue;
    parts.push(`${n} ${label(kind, n)}`);
  }
  if (parts.length === 0) return "activity";
  return parts.join(" + ");
}

function label(kind: CandidateKind, n: number): string {
  switch (kind) {
    case "click":
      return n === 1 ? "click" : "clicks";
    case "typing":
      return n === 1 ? "typing burst" : "typing bursts";
    case "selection":
      return n === 1 ? "selection" : "selections";
    case "scroll":
      return n === 1 ? "scroll" : "scrolls";
    case "dwell":
      return n === 1 ? "pause" : "pauses";
  }
}
