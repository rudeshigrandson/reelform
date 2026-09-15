import type { Size } from "../inspector/frame/types";

/**
 * Preview quality (guide S12 A: Auto / Full / Half) and canvas zoom
 * (guide S12 B: Fit / 50 / 100%). Pure sizing math for PreviewCanvas.
 */

export const PREVIEW_QUALITIES = ["auto", "full", "half"] as const;
export type PreviewQuality = (typeof PREVIEW_QUALITIES)[number];

export const CANVAS_ZOOMS = ["fit", "50", "100"] as const;
export type CanvasZoom = (typeof CANVAS_ZOOMS)[number];

/** Auto quality caps the rendered long edge (device px) here… */
export const AUTO_MAX_LONG_EDGE = 2560;
/** …but never below this, so small sources still render crisp. */
export const AUTO_MIN_LONG_EDGE = 1280;
export const MIN_RESOLUTION = 0.25;

const pos = (n: number, d: number): number => (Number.isFinite(n) && n > 0 ? n : d);

/**
 * Renderer resolution (device px per CSS px). Full = devicePixelRatio;
 * Half = half of it; Auto = devicePixelRatio unless the canvas would render
 * more device pixels than useful (the source's long edge, clamped to
 * 1280–2560), in which case it scales down.
 */
export function previewResolution(
  quality: PreviewQuality,
  devicePixelRatio: number,
  view: Size,
  source: Size | null | undefined,
): number {
  const dpr = pos(devicePixelRatio, 1);
  if (quality === "full") return Math.max(MIN_RESOLUTION, dpr);
  if (quality === "half") return Math.max(MIN_RESOLUTION, dpr / 2);
  const longCss = Math.max(pos(view.width, 1), pos(view.height, 1));
  const srcLong = source
    ? Math.max(pos(source.width, 0), pos(source.height, 0))
    : AUTO_MAX_LONG_EDGE;
  const cap = Math.min(AUTO_MAX_LONG_EDGE, Math.max(AUTO_MIN_LONG_EDGE, srcLong));
  const r = longCss * dpr > cap ? cap / longCss : dpr;
  return Math.max(MIN_RESOLUTION, Math.min(dpr, r));
}

/**
 * Canvas CSS size for a zoom: Fit fills the well; 50/100% render the frame at
 * that fraction of the export output size (the well scrolls when larger).
 */
export function canvasViewSize(zoom: CanvasZoom, well: Size, output: Size): Size {
  if (zoom === "fit") return { width: Math.max(0, well.width), height: Math.max(0, well.height) };
  const k = Number(zoom) / 100;
  return {
    width: Math.max(1, Math.round(pos(output.width, 1920) * k)),
    height: Math.max(1, Math.round(pos(output.height, 1080) * k)),
  };
}

export function canvasZoomLabel(zoom: CanvasZoom): string {
  return zoom === "fit" ? "Fit" : `${zoom}%`;
}
