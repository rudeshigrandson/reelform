import { ANCHORS, type Anchor } from "../../inspector/controls";

/**
 * Webcam bubble drag on canvas (guide S12 state 10): the bubble snaps per axis
 * to the 3×3 grid columns/rows (margin-inset left/center/right, top/middle/
 * bottom). Snapping both axes yields an anchor; otherwise the position is
 * stored as a custom normalized center. All inputs are frame-local px.
 */

export const WEBCAM_SNAP_PX = 10;

export interface BubbleBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WebcamDropResult {
  anchor: Anchor | null;
  customX: number;
  customY: number;
  /** Snapped bubble rect (frame px). */
  rect: BubbleBox;
  /** Guide lines to draw (frame px). */
  guides: { vertical: number[]; horizontal: number[] };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Top-left x positions for columns and y for rows (same margin rule as `bubbleRect`). */
export function webcamGrid(
  frame: { width: number; height: number },
  size: { w: number; h: number },
  marginPx: number,
): { xs: [number, number, number]; ys: [number, number, number] } {
  const W = Math.max(0, frame.width);
  const H = Math.max(0, frame.height);
  const m = Math.max(0, Number.isFinite(marginPx) ? marginPx : 0);
  const mx = Math.max(0, Math.min(m, (W - size.w) / 2));
  const my = Math.max(0, Math.min(m, (H - size.h) / 2));
  const minX = mx;
  const maxX = Math.max(minX, W - mx - size.w);
  const minY = my;
  const maxY = Math.max(minY, H - my - size.h);
  return { xs: [minX, (minX + maxX) / 2, maxX], ys: [minY, (minY + maxY) / 2, maxY] };
}

export function webcamDropPosition(
  dragged: BubbleBox,
  frame: { width: number; height: number },
  marginPx: number,
  snapPx = WEBCAM_SNAP_PX,
): WebcamDropResult {
  const { xs, ys } = webcamGrid(frame, dragged, marginPx);
  let x = clamp(dragged.x, 0, Math.max(0, frame.width - dragged.w));
  let y = clamp(dragged.y, 0, Math.max(0, frame.height - dragged.h));
  const nearest = (v: number, opts: readonly number[]): number => {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    opts.forEach((o, i) => {
      const d = Math.abs(v - o);
      if (d <= snapPx && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };
  const col = nearest(x, xs);
  const row = nearest(y, ys);
  const vertical: number[] = [];
  const horizontal: number[] = [];
  if (col >= 0) {
    x = xs[col] as number;
    vertical.push(col === 0 ? x : col === 1 ? x + dragged.w / 2 : x + dragged.w);
  }
  if (row >= 0) {
    y = ys[row] as number;
    horizontal.push(row === 0 ? y : row === 1 ? y + dragged.h / 2 : y + dragged.h);
  }
  const rect = { x, y, w: dragged.w, h: dragged.h };
  const W = frame.width > 0 ? frame.width : 1;
  const H = frame.height > 0 ? frame.height : 1;
  const customX = clamp((x + dragged.w / 2) / W, 0, 1);
  const customY = clamp((y + dragged.h / 2) / H, 0, 1);
  const anchor = col >= 0 && row >= 0 ? (ANCHORS[row * 3 + col] ?? null) : null;
  return { anchor, customX, customY, rect, guides: { vertical, horizontal } };
}
