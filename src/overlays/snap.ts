import type { Bounds } from "./types";

/**
 * Region selection edge snapping (SPEC §5.7). Pure geometry, kept with the
 * region selector so the overlay needs nothing from the app layer; the app
 * re-exports it from `regionMath`.
 */

export const SNAP_THRESHOLD_PX = 8;

/** Edges a resize handle moves; omitted = the whole rect moves (size kept). */
export interface SnapEdges {
  left?: boolean | undefined;
  right?: boolean | undefined;
  top?: boolean | undefined;
  bottom?: boolean | undefined;
}

const finiteRect = (r: Bounds): boolean =>
  Number.isFinite(r.x) &&
  Number.isFinite(r.y) &&
  Number.isFinite(r.width) &&
  Number.isFinite(r.height);

/** Nearest candidate to `edge` within `threshold`, as a delta (null when none). */
function nearest(edge: number, candidates: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    const d = c - edge;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/**
 * Snap a region selection to window edges: every rect edge within
 * `thresholdPx` of a target's parallel edge lands on it. Targets only count on
 * an axis when they overlap the rect on the other axis (a window far above
 * does not pull a vertical edge). Moving keeps the size and applies the
 * closest snap per axis; resizing snaps only the edges being dragged.
 */
export function snapRect(
  rect: Bounds,
  targets: ReadonlyArray<Bounds>,
  thresholdPx: number = SNAP_THRESHOLD_PX,
  edges?: SnapEdges | undefined,
): Bounds {
  const t = Number.isFinite(thresholdPx) && thresholdPx > 0 ? thresholdPx : 0;
  if (t === 0 || !finiteRect(rect) || targets.length === 0) return { ...rect };
  const valid = targets.filter((r) => finiteRect(r) && r.width > 0 && r.height > 0);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of valid) {
    if (r.y <= rect.y + rect.height + t && r.y + r.height >= rect.y - t)
      xs.push(r.x, r.x + r.width);
    if (r.x <= rect.x + rect.width + t && r.x + r.width >= rect.x - t) ys.push(r.y, r.y + r.height);
  }
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  if (!edges) {
    const pick = (a: number | null, b: number | null): number => {
      if (a === null) return b ?? 0;
      if (b === null) return a;
      return Math.abs(a) <= Math.abs(b) ? a : b;
    };
    const dx = pick(nearest(left, xs, t), nearest(right, xs, t));
    const dy = pick(nearest(top, ys, t), nearest(bottom, ys, t));
    return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
  }

  let l = left;
  let r = right;
  let tp = top;
  let b = bottom;
  if (edges.left) l += nearest(left, xs, t) ?? 0;
  if (edges.right) r += nearest(right, xs, t) ?? 0;
  if (edges.top) tp += nearest(top, ys, t) ?? 0;
  if (edges.bottom) b += nearest(bottom, ys, t) ?? 0;
  // Never snap an edge across its opposite edge.
  if (r - l < 1) {
    l = left;
    r = right;
  }
  if (b - tp < 1) {
    tp = top;
    b = bottom;
  }
  return { x: l, y: tp, width: r - l, height: b - tp };
}
