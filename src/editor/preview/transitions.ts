import type { EffectsSettings, TransitionKind } from "../inspector/effects/types";
import type { Clip } from "../model/schema";

/**
 * Clip-boundary transitions (ENGINEERING_SPEC §9.8). Pure and deterministic in
 * timeline ms; preview and export read the same `TransitionState`.
 *
 * - `cross-dissolve`: over `[boundary − d, boundary]` the incoming clip's first
 *   frame fades in over the outgoing clip. At the boundary the main video is
 *   already on that frame, so the hand-off is seamless.
 * - `cut-with-zoom`: a quick 1.15× eased camera bump centered on the boundary.
 */

/** Peak camera scale multiplier of `cut-with-zoom`. */
export const CUT_ZOOM_PEAK = 1.15;

export interface ClipBoundary {
  /** Timeline ms where `incoming` starts. */
  atMs: number;
  outgoing: Clip;
  incoming: Clip;
}

/**
 * Scene input for transitions: the project-wide transition from
 * `effects.transition` applied at every boundary between consecutive clips.
 */
export interface SceneTransitionInput {
  kind: TransitionKind;
  durationMs: number;
  clips: readonly Clip[];
}

/** The transition active at a timeline time; `null` outside every window. */
export interface TransitionState {
  kind: Exclude<TransitionKind, "none">;
  /** Timeline ms of the clip boundary. */
  boundaryMs: number;
  /** 0..1 through the transition window. */
  progress: number;
  /** Cross-dissolve: opacity of the incoming frame over the live video (0 for cut-with-zoom). */
  mix: number;
  /** Cut-with-zoom: camera scale multiplier (1 for cross-dissolve). */
  zoom: number;
  outgoingClipId: string;
  incomingClipId: string;
  /** Source ms of the incoming clip's first frame (what the second video texture shows). */
  incomingSourceMs: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const easeInOut = (p: number): number => {
  const x = clamp01(p);
  return x * x * (3 - 2 * x);
};

/** Boundaries between clips that sit end-to-start on the timeline, in timeline order. */
export function clipBoundaries(clips: readonly Clip[] | null | undefined): ClipBoundary[] {
  if (!clips || clips.length < 2) return [];
  const sorted = [...clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  const out: ClipBoundary[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const outgoing = sorted[i - 1] as Clip;
    const incoming = sorted[i] as Clip;
    out.push({ atMs: incoming.timelineStartMs, outgoing, incoming });
  }
  return out;
}

const clipLength = (c: Clip): number => Math.max(0, c.sourceEndMs - c.sourceStartMs);

/** Scene transition input from project effects + clips (none / single clip → undefined). */
export function transitionInputFrom(
  effects: Pick<EffectsSettings, "transition"> | undefined,
  clips: readonly Clip[] | null | undefined,
): SceneTransitionInput | undefined {
  if (!effects || effects.transition.kind === "none" || !clips || clips.length < 2) {
    return undefined;
  }
  return { kind: effects.transition.kind, durationMs: effects.transition.durationMs, clips };
}

/**
 * Source ms of the incoming clip's first frame for the boundary at or after
 * `tMs` (the one a cross-dissolve would show next), or null past the last
 * boundary. Lets the preview park its second video before the window opens.
 */
export function upcomingIncomingSourceMs(
  clips: readonly Clip[] | null | undefined,
  tMs: number,
): number | null {
  if (!Number.isFinite(tMs)) return null;
  for (const b of clipBoundaries(clips)) {
    if (b.atMs > tMs) return b.incoming.sourceStartMs;
  }
  return null;
}

export function transitionAt(
  input: SceneTransitionInput | null | undefined,
  tMs: number,
): TransitionState | null {
  if (!input || input.kind === "none" || !Number.isFinite(tMs)) return null;
  const d = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;
  if (d <= 0) return null;
  for (const b of clipBoundaries(input.clips)) {
    if (input.kind === "cross-dissolve") {
      // The dissolve lives inside the outgoing clip; never longer than it.
      const len = Math.min(d, clipLength(b.outgoing));
      if (len <= 0 || tMs < b.atMs - len || tMs >= b.atMs) continue;
      const progress = clamp01((tMs - (b.atMs - len)) / len);
      return {
        kind: "cross-dissolve",
        boundaryMs: b.atMs,
        progress,
        mix: easeInOut(progress),
        zoom: 1,
        outgoingClipId: b.outgoing.id,
        incomingClipId: b.incoming.id,
        incomingSourceMs: b.incoming.sourceStartMs,
      };
    }
    const half = Math.min(d / 2, clipLength(b.outgoing), clipLength(b.incoming));
    if (half <= 0 || tMs < b.atMs - half || tMs > b.atMs + half) continue;
    const progress = clamp01((tMs - (b.atMs - half)) / (2 * half));
    return {
      kind: "cut-with-zoom",
      boundaryMs: b.atMs,
      progress,
      mix: 0,
      zoom: 1 + (CUT_ZOOM_PEAK - 1) * easeInOut(1 - Math.abs(2 * progress - 1)),
      outgoingClipId: b.outgoing.id,
      incomingClipId: b.incoming.id,
      incomingSourceMs: b.incoming.sourceStartMs,
    };
  }
  return null;
}
