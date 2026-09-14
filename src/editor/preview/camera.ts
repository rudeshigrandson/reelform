import type { ZoomRegion } from "../inspector/zoom/types";
import { easeValue } from "../inspector/zoom/zoomLogic";

/**
 * Camera / zoom math — ENGINEERING_SPEC §6.5. Pure and deterministic: every
 * value is a function of the regions + `tMs` (no frame deltas, no Date.now).
 */

/** Anything that can report a normalized (0..1) cursor position for a time. */
export interface CursorPositionSource {
  positionAt(tMs: number): { x: number; y: number };
}

export interface Point {
  x: number;
  y: number;
}

export interface ZoomSample {
  level: number;
  region: ZoomRegion | null;
}

const finiteOr = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * The region active at `tMs` (inclusive of both ends). The model disallows
 * overlaps; if some slip through, the region with the latest `startMs` that
 * contains `t` wins (ties → the later entry in the array).
 */
export function activeRegionAt(regions: readonly ZoomRegion[], tMs: number): ZoomRegion | null {
  let best: ZoomRegion | null = null;
  for (const r of regions) {
    if (!(r.endMs > r.startMs) || tMs < r.startMs || tMs > r.endMs) continue;
    if (best === null || r.startMs >= best.startMs) best = r;
  }
  return best;
}

/**
 * Zoom level `z(t)`: eases 1 → level over `easeInMs` from `startMs`, holds,
 * then eases level → 1 over `easeOutMs` ending exactly at `endMs`. When the
 * two ease durations exceed the region length both are scaled down
 * proportionally. Spring may overshoot above `level` on the way in; the
 * result is floored at 1 because a level below 1 would reveal content edges.
 * Outside every region the level is 1.
 */
export function zoomLevelAt(regions: readonly ZoomRegion[], tMs: number): ZoomSample {
  if (!Number.isFinite(tMs)) return { level: 1, region: null };
  const region = activeRegionAt(regions, tMs);
  if (!region) return { level: 1, region: null };

  const target = Math.max(1, finiteOr(region.level, 1));
  const length = region.endMs - region.startMs;
  let easeIn = Math.max(0, finiteOr(region.easeInMs, 0));
  let easeOut = Math.max(0, finiteOr(region.easeOutMs, 0));
  if (easeIn + easeOut > length) {
    const k = length / (easeIn + easeOut);
    easeIn *= k;
    easeOut *= k;
  }

  let level = target;
  const outStart = region.endMs - easeOut;
  if (easeIn > 0 && tMs < region.startMs + easeIn) {
    const p = (tMs - region.startMs) / easeIn;
    level = 1 + (target - 1) * easeValue(region.curve, p);
  } else if (easeOut > 0 && tMs > outStart) {
    const p = (tMs - outStart) / easeOut;
    level = target + (1 - target) * easeValue(region.curve, p);
  }
  return { level: Math.max(1, level), region };
}

/**
 * Focus point `f(t)` in normalized content coords. `fixed` → the region's
 * point; `follow` → the smoothed cursor position (falls back to the region's
 * point when no cursor track exists). Always clamped to 0..1.
 */
export function focusAt(
  region: ZoomRegion,
  tMs: number,
  cursor?: CursorPositionSource | null | undefined,
): Point {
  const fallback = { x: finiteOr(region.focus.x, 0.5), y: finiteOr(region.focus.y, 0.5) };
  let p = fallback;
  if (region.focus.mode === "follow" && cursor) {
    const c = cursor.positionAt(tMs);
    p = { x: finiteOr(c.x, fallback.x), y: finiteOr(c.y, fallback.y) };
  }
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

export interface CameraInput {
  level: number;
  /** Normalized 0..1 content coords. */
  focus: Point;
  contentW: number;
  contentH: number;
}

/** CameraContainer transform, in content-local pixels. */
export interface CameraTransform {
  scale: number;
  pivotX: number;
  pivotY: number;
  positionX: number;
  positionY: number;
}

/**
 * `scale = z`, `pivot = f * contentSize`, `position = contentCenter` (§6.5).
 * The pivot is clamped so the visible rect (contentW/scale × contentH/scale)
 * stays inside the content bounds; at level 1 this is the identity
 * (pivot = position = center).
 */
export function cameraTransform({
  level,
  focus,
  contentW,
  contentH,
}: CameraInput): CameraTransform {
  const w = Math.max(0, finiteOr(contentW, 0));
  const h = Math.max(0, finiteOr(contentH, 0));
  const scale = Math.max(1, finiteOr(level, 1));
  const halfW = w / (2 * scale);
  const halfH = h / (2 * scale);
  const fx = clamp(finiteOr(focus.x, 0.5), 0, 1) * w;
  const fy = clamp(finiteOr(focus.y, 0.5), 0, 1) * h;
  return {
    scale,
    pivotX: clamp(fx, halfW, w - halfW),
    pivotY: clamp(fy, halfH, h - halfH),
    positionX: w / 2,
    positionY: h / 2,
  };
}

/** Webcam bubble zoom-reactive scale: `1 / (1 + (z-1)*0.5)` (§6.5). */
export function webcamZoomReactiveScale(level: number): number {
  const z = Math.max(1, finiteOr(level, 1));
  return 1 / (1 + (z - 1) * 0.5);
}
