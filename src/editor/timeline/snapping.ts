import type { TimeSpan } from "./types";

/**
 * Snapping (ENGINEERING_SPEC §6.7): playhead, item edges on all tracks, clip
 * boundaries, 1s grid when zoomed out. Tolerance 6px; alt bypasses.
 */

export const SNAP_TOLERANCE_PX = 6;
export const GRID_MS = 1000;
/** "Zoomed out" = one second spans at most 100px; closer in, the grid stops snapping. */
export const GRID_MAX_PX_PER_MS = 0.1;

export interface SnapOptions {
  readonly enabled: boolean;
  /** Alt held: snap is skipped for this gesture. */
  readonly bypass?: boolean | undefined;
  readonly tolerancePx?: number | undefined;
}

export interface SnapResult {
  readonly ms: number;
  readonly snappedTo: number | null;
}

/** Snap `candidateMs` to the nearest target within tolerance (in px at the current zoom). */
export function snap(
  candidateMs: number,
  targets: readonly number[],
  scale: { readonly pxPerMs: number },
  options: SnapOptions,
): SnapResult {
  if (!options.enabled || options.bypass || !(scale.pxPerMs > 0)) {
    return { ms: candidateMs, snappedTo: null };
  }
  const toleranceMs = (options.tolerancePx ?? SNAP_TOLERANCE_PX) / scale.pxPerMs;
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    const d = Math.abs(t - candidateMs);
    if (d <= toleranceMs && d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best === null ? { ms: candidateMs, snappedTo: null } : { ms: best, snappedTo: best };
}

export interface SnapTargetInput {
  readonly playheadMs: number;
  readonly items: readonly TimeSpan[];
  /** Ids being dragged — their own edges must not attract them. */
  readonly excludeIds?: ReadonlySet<string> | undefined;
  readonly clipBoundaries?: readonly number[] | undefined;
  /** Caption word starts/ends (timeline ms), added while dragging a caption. */
  readonly wordBoundaries?: readonly number[] | undefined;
  /** Current zoom; enables the 1s grid when ≤ GRID_MAX_PX_PER_MS. */
  readonly pxPerMs?: number | undefined;
  /** Grid lines are generated over [0, durationMs]. */
  readonly durationMs?: number | undefined;
}

/** Sorted, de-duplicated snap targets. */
export function collectSnapTargets(input: SnapTargetInput): number[] {
  const out = new Set<number>();
  if (Number.isFinite(input.playheadMs)) out.add(input.playheadMs);
  for (const item of input.items) {
    if (input.excludeIds?.has(item.id)) continue;
    out.add(item.startMs);
    out.add(item.endMs);
  }
  for (const b of input.clipBoundaries ?? []) out.add(b);
  for (const b of input.wordBoundaries ?? []) out.add(b);
  const px = input.pxPerMs;
  const duration = input.durationMs;
  if (px !== undefined && px > 0 && px <= GRID_MAX_PX_PER_MS && duration !== undefined) {
    const count = Math.floor(Math.max(0, duration) / GRID_MS);
    for (let i = 0; i <= count && i <= 100000; i++) out.add(i * GRID_MS);
  }
  return [...out].filter(Number.isFinite).sort((a, b) => a - b);
}
