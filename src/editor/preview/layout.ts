import { aspectRatio, resolvePadding } from "../inspector/frame/frameLogic";
import type { FrameSettings, Size } from "../inspector/frame/types";

/**
 * Pure frame layout for the preview canvas (ENGINEERING_SPEC §6.4 FrameRoot /
 * ContentGroup, §9.1). All outputs are CSS pixels in canvas space.
 *
 * Reference output: every pixel-valued Frame setting (padding, radius,
 * border, shadow, blur) is authored in pixels of a reference frame whose
 * **long edge is 1920px** (i.e. 1920-wide for landscape presets, 1920-tall for
 * portrait). The preview scales them by `frameLongEdge / 1920`, so the framed
 * look is identical at any canvas size; export must apply the same rule
 * against its output long edge.
 */
export const LAYOUT_REFERENCE_LONG_EDGE = 1920;

/** Aspect used when "source" is selected but the source size is unknown. */
const FALLBACK_RATIO = 16 / 9;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FrameLayout {
  canvas: Size;
  /** Output width / height of the frame. */
  aspectRatio: number;
  /** Letterboxed frame box at the chosen aspect, centered in the canvas. */
  frame: Rect;
  /** Reference → canvas pixel factor (frame long edge / 1920). */
  scale: number;
  /** Scaled padding (shrunk proportionally if it would exceed the frame). */
  padding: Insets;
  /** Frame minus padding. */
  paddedArea: Rect;
  /** Source aspect fitted in the padded area, then scaled by inset%. */
  content: Rect;
  radius: number;
  borderWidth: number;
  shadowOffsetY: number;
  shadowBlur: number;
  backgroundBlur: number;
}

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Largest `ratio` rect that fits `box`, centered. Zero-size safe. */
export function fitRect(box: Rect, ratio: number): Rect {
  const w = nonNeg(box.width);
  const h = nonNeg(box.height);
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  let width = w;
  let height = w / r;
  if (height > h) {
    height = h;
    width = h * r;
  }
  return { x: box.x + (w - width) / 2, y: box.y + (h - height) / 2, width, height };
}

/** Shrinks a pair of opposing insets proportionally so they fit `span`. */
function fitPair(a: number, b: number, span: number): [number, number] {
  const sum = a + b;
  if (sum <= span || sum <= 0) return [a, b];
  const k = span / sum;
  return [a * k, b * k];
}

/** Effective source aspect, honoring the normalized crop rect. */
function sourceRatio(
  frame: FrameSettings,
  source: Size | null | undefined,
  fallback: number,
): number {
  if (!source || !(source.width > 0) || !(source.height > 0)) return fallback;
  const cw = frame.crop && frame.crop.width > 0 ? frame.crop.width : 1;
  const ch = frame.crop && frame.crop.height > 0 ? frame.crop.height : 1;
  return (source.width * cw) / (source.height * ch);
}

export function computeFrameLayout(
  canvasSize: Size,
  frame: FrameSettings,
  source: Size | null | undefined,
): FrameLayout {
  const canvas = { width: nonNeg(canvasSize.width), height: nonNeg(canvasSize.height) };
  const ratio = aspectRatio(frame.aspect, source) ?? FALLBACK_RATIO;
  const box = fitRect({ x: 0, y: 0, ...canvas }, ratio);
  const scale = Math.max(box.width, box.height) / LAYOUT_REFERENCE_LONG_EDGE;

  const raw = resolvePadding(frame.padding);
  const [left, right] = fitPair(nonNeg(raw.left) * scale, nonNeg(raw.right) * scale, box.width);
  const [top, bottom] = fitPair(nonNeg(raw.top) * scale, nonNeg(raw.bottom) * scale, box.height);
  const paddedArea: Rect = {
    x: box.x + left,
    y: box.y + top,
    width: Math.max(0, box.width - left - right),
    height: Math.max(0, box.height - top - bottom),
  };

  const fitted = fitRect(paddedArea, sourceRatio(frame, source, ratio));
  const inset = Number.isFinite(frame.inset) ? Math.min(100, Math.max(0, frame.inset)) / 100 : 1;
  const content: Rect = {
    x: fitted.x + (fitted.width * (1 - inset)) / 2,
    y: fitted.y + (fitted.height * (1 - inset)) / 2,
    width: fitted.width * inset,
    height: fitted.height * inset,
  };

  return {
    canvas,
    aspectRatio: ratio,
    frame: box,
    scale,
    padding: { top, right, bottom, left },
    paddedArea,
    content,
    radius: Math.min(nonNeg(frame.radius) * scale, Math.min(content.width, content.height) / 2),
    borderWidth: nonNeg(frame.border.width) * scale,
    shadowOffsetY: (Number.isFinite(frame.shadow.offsetY) ? frame.shadow.offsetY : 0) * scale,
    shadowBlur: nonNeg(frame.shadow.blur) * scale,
    backgroundBlur: nonNeg(frame.blur) * scale,
  };
}
