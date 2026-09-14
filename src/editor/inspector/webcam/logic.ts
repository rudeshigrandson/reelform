import { anchorToPoint, clamp } from "../controls";
import { type CropRect, WEBCAM_LIMITS, type WebcamSettings, type WebcamShape } from "./types";

/**
 * Pure webcam math (design guide S16, ENGINEERING_SPEC §6.5 / §9.4). Deterministic
 * so preview and export agree.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Width / height of the "pill" bubble and its crop. */
export const PILL_ASPECT = 16 / 9;

/** Smallest crop edge in source px, so a crop never collapses. */
export const MIN_CROP_PX = 16;

const finiteOr = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);

/** Aspect ratio (w/h) of the bubble — also the aspect of its crop. */
export function shapeAspect(shape: WebcamShape): number {
  return shape === "pill" ? PILL_ASPECT : 1;
}

/**
 * Bubble rect inside an output frame. Height = sizePct of frame height; width
 * follows the shape aspect. The bubble is shrunk to fit the frame, margin is
 * reduced when it can't fit alongside the bubble, and the result always stays
 * inside `[0, frame]`.
 */
export function bubbleRect(
  frame: Size,
  s: Pick<WebcamSettings, "shape" | "sizePct" | "anchor" | "customX" | "customY" | "marginPx">,
): Rect {
  const W = Math.max(0, finiteOr(frame.width, 0));
  const H = Math.max(0, finiteOr(frame.height, 0));
  const aspect = shapeAspect(s.shape);
  const pct = clamp(
    finiteOr(s.sizePct, WEBCAM_LIMITS.sizePct.min),
    WEBCAM_LIMITS.sizePct.min,
    WEBCAM_LIMITS.sizePct.max,
  );

  let h = (H * pct) / 100;
  let w = h * aspect;
  if (w > W) {
    w = W;
    h = w / aspect;
  }

  const m = Math.max(0, finiteOr(s.marginPx, 0));
  const mx = Math.min(m, (W - w) / 2);
  const my = Math.min(m, (H - h) / 2);
  const minX = mx;
  const maxX = W - mx - w;
  const minY = my;
  const maxY = H - my - h;

  if (s.anchor !== null) {
    const p = anchorToPoint(s.anchor);
    return { x: minX + p.x * (maxX - minX), y: minY + p.y * (maxY - minY), w, h };
  }
  const cx = clamp(finiteOr(s.customX, 0.5), 0, 1) * W;
  const cy = clamp(finiteOr(s.customY, 0.5), 0, 1) * H;
  return { x: clamp(cx - w / 2, minX, maxX), y: clamp(cy - h / 2, minY, maxY), w, h };
}

/** Corner radius (px) the bubble mask should use for a given rect. */
export function bubbleCornerRadius(
  shape: WebcamShape,
  radius: number,
  rect: Pick<Rect, "w" | "h">,
): number {
  const half = Math.min(rect.w, rect.h) / 2;
  switch (shape) {
    case "circle":
    case "pill":
      return half;
    case "square":
      return 0;
    case "rounded":
      return clamp(finiteOr(radius, 0), 0, half);
  }
}

/** §6.5: bubble scale = 1 / (1 + (z-1)*0.5); identity when zoom-reactive is off. */
export function zoomReactiveScale(zoom: number, zoomReactive: boolean): number {
  if (!zoomReactive) return 1;
  const z = Math.max(1, finiteOr(zoom, 1));
  return 1 / (1 + (z - 1) * 0.5);
}

/** Integer ms within the sync-offset limits; non-finite → 0. */
export function clampSyncOffset(ms: number): number {
  const { min, max } = WEBCAM_LIMITS.syncOffsetMs;
  return Math.round(clamp(finiteOr(ms, 0), min, max));
}

/** Largest centered rect of `aspect` that fits the source. */
export function fitCrop(source: Size, aspect: number): CropRect {
  const W = Math.max(1, finiteOr(source.width, 1));
  const H = Math.max(1, finiteOr(source.height, 1));
  const w = Math.min(W, H * aspect);
  const h = w / aspect;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** Clamp an arbitrary crop so it lies within the source and is at least MIN_CROP_PX. */
export function clampCrop(rect: CropRect, source: Size): CropRect {
  const W = Math.max(1, finiteOr(source.width, 1));
  const H = Math.max(1, finiteOr(source.height, 1));
  const w = clamp(finiteOr(rect.w, W), Math.min(MIN_CROP_PX, W), W);
  const h = clamp(finiteOr(rect.h, H), Math.min(MIN_CROP_PX, H), H);
  const x = clamp(finiteOr(rect.x, 0), 0, W - w);
  const y = clamp(finiteOr(rect.y, 0), 0, H - h);
  return { x, y, w, h };
}

/**
 * Crop for a zoom level (1 = largest fit) centered on a normalized point. The
 * center is pushed inward so the crop never leaves the source.
 */
export function cropFromZoom(
  source: Size,
  aspect: number,
  zoom: number,
  center: { x: number; y: number },
): CropRect {
  const W = Math.max(1, finiteOr(source.width, 1));
  const H = Math.max(1, finiteOr(source.height, 1));
  const { min, max } = WEBCAM_LIMITS.cropZoom;
  const z = clamp(finiteOr(zoom, 1), min, max);
  const base = fitCrop({ width: W, height: H }, aspect);
  const w = base.w / z;
  const h = base.h / z;
  const cx = clamp(finiteOr(center.x, 0.5), 0, 1) * W;
  const cy = clamp(finiteOr(center.y, 0.5), 0, 1) * H;
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
}

/** Inverse of cropFromZoom: zoom level and normalized center of a crop. `null` → full fit, centered. */
export function cropToView(
  rect: CropRect | null,
  source: Size,
  aspect: number,
): { zoom: number; center: { x: number; y: number } } {
  if (rect === null) return { zoom: 1, center: { x: 0.5, y: 0.5 } };
  const c = clampCrop(rect, source);
  const base = fitCrop(source, aspect);
  const { min, max } = WEBCAM_LIMITS.cropZoom;
  return {
    zoom: clamp(base.w / c.w, min, max),
    center: { x: (c.x + c.w / 2) / source.width, y: (c.y + c.h / 2) / source.height },
  };
}

/** "00:42" / "1:02:05" for the recorded-webcam label. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(finiteOr(ms, 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
