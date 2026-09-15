import { type HandleId, handleDir } from "./gizmoMath";

/**
 * Crop mode math (ENGINEERING_SPEC §9.1, guide S12 state 9). The crop is a
 * normalized source rect (`FrameSettings.crop`). Handles resize with the
 * opposite edge fixed; the result always lies within [0, 1] and is at least
 * `MIN_CROP` on each side. Aspect lock keeps the normalized w/h ratio (the
 * source aspect is constant, so this keeps the pixel aspect too).
 */

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: Readonly<NormRect> = { x: 0, y: 0, width: 1, height: 1 };
export const MIN_CROP = 0.05;
const EPS = 1e-9;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function clampCropRect(r: NormRect, min = MIN_CROP): NormRect {
  const width = clamp(r.width, min, 1);
  const height = clamp(r.height, min, 1);
  return { x: clamp(r.x, 0, 1 - width), y: clamp(r.y, 0, 1 - height), width, height };
}

export function moveCrop(r: NormRect, dx: number, dy: number): NormRect {
  return clampCropRect({
    ...r,
    x: r.x + (Number.isFinite(dx) ? dx : 0),
    y: r.y + (Number.isFinite(dy) ? dy : 0),
  });
}

/**
 * Drag `handle` by (dx, dy) normalized units. `aspect` (normalized w/h) locks
 * the ratio; null/undefined = free.
 */
export function resizeCrop(
  start: NormRect,
  handle: HandleId,
  dx: number,
  dy: number,
  aspect?: number | null | undefined,
  min = MIN_CROP,
): NormRect {
  const r = clampCropRect(start, min);
  const { sx, sy } = handleDir(handle);
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  const ddx = Number.isFinite(dx) ? dx : 0;
  const ddy = Number.isFinite(dy) ? dy : 0;
  if (sx < 0) left = clamp(left + ddx, 0, right - min);
  if (sx > 0) right = clamp(right + ddx, left + min, 1);
  if (sy < 0) top = clamp(top + ddy, 0, bottom - min);
  if (sy > 0) bottom = clamp(bottom + ddy, top + min, 1);
  let w = right - left;
  let h = bottom - top;

  const lock =
    aspect !== null && aspect !== undefined && Number.isFinite(aspect) && aspect > 0
      ? aspect
      : null;
  if (lock === null) return clampCropRect({ x: left, y: top, width: w, height: h }, min);

  // Desired size along the dragged axis; the other axis follows.
  if (sx !== 0 && sy !== 0) {
    if (w / h > lock) h = w / lock;
    else w = h * lock;
  } else if (sx !== 0) {
    h = w / lock;
  } else {
    w = h * lock;
  }
  // Space available from the fixed anchor.
  const ax = sx < 0 ? r.x + r.width : sx > 0 ? r.x : r.x + r.width / 2;
  const ay = sy < 0 ? r.y + r.height : sy > 0 ? r.y : r.y + r.height / 2;
  const maxW = sx < 0 ? ax : sx > 0 ? 1 - ax : 2 * Math.min(ax, 1 - ax);
  const maxH = sy < 0 ? ay : sy > 0 ? 1 - ay : 2 * Math.min(ay, 1 - ay);
  const shrink = Math.min(1, maxW / Math.max(w, EPS), maxH / Math.max(h, EPS));
  w *= shrink;
  h *= shrink;
  // Enforce the minimum while keeping the ratio (may exceed bounds only if impossible).
  const grow = Math.max(1, min / Math.max(w, EPS), min / Math.max(h, EPS));
  w = Math.min(1, w * grow);
  h = Math.min(1, h * grow);
  const x = sx < 0 ? ax - w : sx > 0 ? ax : ax - w / 2;
  const y = sy < 0 ? ay - h : sy > 0 ? ay : ay - h / 2;
  return clampCropRect({ x, y, width: w, height: h }, Math.min(min, w, h));
}

/** A crop that covers the whole source is stored as null. */
export function normalizeCrop(r: NormRect | null | undefined): NormRect | null {
  if (!r) return null;
  const c = clampCropRect(r);
  const full = c.x <= EPS && c.y <= EPS && c.width >= 1 - 1e-6 && c.height >= 1 - 1e-6;
  return full ? null : c;
}
