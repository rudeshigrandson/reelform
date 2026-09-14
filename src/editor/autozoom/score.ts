/**
 * Stage 3 — Score & suppress (ENGINEERING_SPEC §8.3).
 * strength × sensitivityWeight, non-max suppression within 800ms, and dropping
 * candidates that fall inside trimmed-away (not kept) ranges.
 */

import type { Candidate } from "./candidates.js";
import type { ClipRange } from "./types.js";

export const NMS_WINDOW_MS = 800;

export interface ScoredCandidate extends Candidate {
  readonly score: number;
}

/**
 * sensitivity in 0..1 → multiplicative weight in ~[0.7, 1.3]. At 0.5 it is
 * neutral (1.0); higher sensitivity boosts weak candidates.
 */
export function sensitivityWeight(sensitivity: number): number {
  const s = sensitivity < 0 ? 0 : sensitivity > 1 ? 1 : sensitivity;
  return 0.7 + s * 0.6;
}

/**
 * Kept timeline ranges. Telemetry times are treated as source times; each clip
 * keeps [sourceStartMs, sourceEndMs). A candidate whose time is not inside any
 * kept clip source range is considered "inside a trimmed range" and dropped.
 * If there are no clips, nothing is trimmed.
 */
export function isInsideTrimmed(tMs: number, clips: readonly ClipRange[]): boolean {
  if (clips.length === 0) return false;
  for (const c of clips) {
    if (tMs >= c.sourceStartMs && tMs < c.sourceEndMs) return false;
  }
  return true;
}

export function scoreCandidates(
  candidates: readonly Candidate[],
  sensitivity: number,
  clips: readonly ClipRange[],
): ScoredCandidate[] {
  const w = sensitivityWeight(sensitivity);
  const scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    if (isInsideTrimmed(c.tMs, clips)) continue;
    scored.push({ ...c, score: c.strength * w });
  }
  return scored;
}

/**
 * Non-max suppression: keep candidates in descending score order, discarding any
 * later candidate within NMS_WINDOW_MS of an already-kept, stronger one.
 * Returns survivors sorted by time.
 */
export function nonMaxSuppress(scored: readonly ScoredCandidate[]): ScoredCandidate[] {
  const byScore = scored
    .slice()
    .sort((a, b) => b.score - a.score || a.tMs - b.tMs);
  const kept: ScoredCandidate[] = [];
  for (const c of byScore) {
    let suppressed = false;
    for (const k of kept) {
      if (Math.abs(k.tMs - c.tMs) < NMS_WINDOW_MS) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(c);
  }
  kept.sort((a, b) => a.tMs - b.tMs);
  return kept;
}
