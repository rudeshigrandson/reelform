/**
 * TransformGizmo math (ENGINEERING_SPEC §9.7): move, 8 resize handles, rotate.
 * Works in canvas px so rotation is isotropic; callers convert to the
 * annotation's frame-normalized box with `frameNormScale`. Rotation is in
 * degrees around the box center (the annotation model's convention).
 */

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type HandleId = (typeof HANDLES)[number];

export interface GizmoBox {
  /** Top-left of the un-rotated box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise (y down). */
  rotation: number;
}

export const ROTATE_SNAP_DEG = 15;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const fin = (n: number, d = 0): number => (Number.isFinite(n) ? n : d);

/** Unit handle direction in box-local space (-1, 0, 1). */
export function handleDir(h: HandleId): { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } {
  return {
    sx: h.includes("w") ? -1 : h.includes("e") ? 1 : 0,
    sy: h.includes("n") ? -1 : h.includes("s") ? 1 : 0,
  };
}

function rotate(x: number, y: number, deg: number): { x: number; y: number } {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: x * c - y * s, y: x * s + y * c };
}

export function boxCenter(b: GizmoBox): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Canvas position of a handle on the rotated box. */
export function handlePoint(b: GizmoBox, h: HandleId): { x: number; y: number } {
  const { sx, sy } = handleDir(h);
  const c = boxCenter(b);
  const r = rotate((sx * b.width) / 2, (sy * b.height) / 2, b.rotation);
  return { x: c.x + r.x, y: c.y + r.y };
}

export function moveBox(b: GizmoBox, dx: number, dy: number): GizmoBox {
  return { ...b, x: b.x + fin(dx), y: b.y + fin(dy) };
}

export interface ResizeOptions {
  /** Keep the start aspect ratio (corner handles; shift-drag). */
  keepAspect?: boolean | undefined;
  /** Minimum width/height in px. */
  minSize?: number | undefined;
}

/**
 * Resize by dragging `handle` by (dx, dy) canvas px, keeping the opposite
 * handle fixed on the canvas. Deltas are projected into the box's rotated
 * frame. Size never drops below `minSize` (the box doesn't flip).
 */
export function resizeBox(
  b: GizmoBox,
  handle: HandleId,
  dx: number,
  dy: number,
  opts: ResizeOptions = {},
): GizmoBox {
  const min = Math.max(0, fin(opts.minSize ?? 4, 4));
  const { sx, sy } = handleDir(handle);
  const local = rotate(fin(dx), fin(dy), -b.rotation);
  let w = sx === 0 ? b.width : Math.max(min, b.width + sx * local.x);
  let h = sy === 0 ? b.height : Math.max(min, b.height + sy * local.y);
  if (opts.keepAspect && sx !== 0 && sy !== 0 && b.width > 0 && b.height > 0) {
    const k = Math.max(w / b.width, h / b.height, min / b.width, min / b.height);
    w = b.width * k;
    h = b.height * k;
  }
  // Opposite anchor, in local coords relative to the old center, stays put.
  const ax = (-sx * b.width) / 2;
  const ay = (-sy * b.height) / 2;
  const newCenterLocal = { x: ax + (sx * w) / 2, y: ay + (sy * h) / 2 };
  const off = rotate(sx === 0 ? 0 : newCenterLocal.x, sy === 0 ? 0 : newCenterLocal.y, b.rotation);
  const c = boxCenter(b);
  const cx = c.x + off.x;
  const cy = c.y + off.y;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation: b.rotation };
}

/** Normalize degrees to (-180, 180]. */
export function normalizeDeg(deg: number): number {
  let d = fin(deg) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d === 0 ? 0 : d;
}

/**
 * Rotation for a pointer at `p` around the box center; the rotate handle sits
 * above the box (pointer straight up = 0°). `snap` rounds to 15° steps.
 */
export function rotationFromPointer(
  b: GizmoBox,
  p: { x: number; y: number },
  snap = false,
): number {
  const c = boxCenter(b);
  const deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  const r = snap ? Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG : deg;
  return normalizeDeg(r);
}
