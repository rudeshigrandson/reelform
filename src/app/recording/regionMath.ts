import type { RegionRect } from "./bus";

/**
 * Region overlay result (§5.7): the overlay window covers one display, so its
 * CSS pixels are display-local DIPs. `region` (DIP, what `recording:start`
 * expects — the same units as display bounds) is clamped into the display and
 * rounded; `pixelRegion` is the same rect in device pixels (× scaleFactor).
 */

export interface RegionSelection {
  region: RegionRect;
  pixelRegion: RegionRect;
  scaleFactor: number;
}

export interface Viewport {
  width: number;
  height: number;
}

const safeScale = (s: number): number => (Number.isFinite(s) && s > 0 ? s : 1);

export function toRegionSelection(
  bounds: RegionRect,
  viewport: Viewport,
  scaleFactor: number,
): RegionSelection | null {
  const vw = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 0;
  const vh = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 0;
  const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
  const x0 = Math.min(vw, Math.max(0, Math.round(fin(bounds.x))));
  const y0 = Math.min(vh, Math.max(0, Math.round(fin(bounds.y))));
  const x1 = Math.min(vw, Math.max(0, Math.round(fin(bounds.x) + fin(bounds.width))));
  const y1 = Math.min(vh, Math.max(0, Math.round(fin(bounds.y) + fin(bounds.height))));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) return null;
  const scale = safeScale(scaleFactor);
  return {
    region: { x: x0, y: y0, width, height },
    pixelRegion: {
      x: Math.round(x0 * scale),
      y: Math.round(y0 * scale),
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    },
    scaleFactor: scale,
  };
}

/** A centered 16:9 starting rect covering ~60% of the display. */
export function defaultRegionBounds(viewport: Viewport): RegionRect {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  let width = Math.round(vw * 0.6);
  let height = Math.round((width * 9) / 16);
  if (height > vh * 0.8) {
    height = Math.round(vh * 0.6);
    width = Math.round((height * 16) / 9);
  }
  return { x: Math.round((vw - width) / 2), y: Math.round((vh - height) / 2), width, height };
}
