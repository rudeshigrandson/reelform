import type { CameraTransform } from "../camera";
import type { FrameLayout } from "../layout";

/**
 * Canvas ↔ scene coordinate mapping for the interaction overlays. Canvas px
 * are the preview well's CSS px (what `computeFrameLayout` returns).
 *
 * - frame-normalized: 0..1 of the output frame (annotations, webcam custom pos)
 * - content-normalized: 0..1 of the (cropped) content (zoom focus, cursor)
 * - `followZoom` items are drawn in CameraContainer, so the camera applies.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IDENTITY_CAMERA = (layout: FrameLayout): CameraTransform => ({
  scale: 1,
  pivotX: layout.content.width / 2,
  pivotY: layout.content.height / 2,
  positionX: layout.content.width / 2,
  positionY: layout.content.height / 2,
});

/** Content-local px → canvas px through the camera. */
export function contentLocalToCanvas(p: Pt, layout: FrameLayout, cam: CameraTransform): Pt {
  return {
    x: layout.content.x + (p.x - cam.pivotX) * cam.scale + cam.positionX,
    y: layout.content.y + (p.y - cam.pivotY) * cam.scale + cam.positionY,
  };
}

export function canvasToContentLocal(p: Pt, layout: FrameLayout, cam: CameraTransform): Pt {
  const s = cam.scale > 0 ? cam.scale : 1;
  return {
    x: (p.x - layout.content.x - cam.positionX) / s + cam.pivotX,
    y: (p.y - layout.content.y - cam.positionY) / s + cam.pivotY,
  };
}

/** Frame-normalized point → canvas px (camera applies when `followZoom`). */
export function frameNormToCanvas(
  p: Pt,
  layout: FrameLayout,
  cam: CameraTransform,
  followZoom: boolean,
): Pt {
  const fx = layout.frame.x + p.x * layout.frame.width;
  const fy = layout.frame.y + p.y * layout.frame.height;
  if (!followZoom) return { x: fx, y: fy };
  return contentLocalToCanvas({ x: fx - layout.content.x, y: fy - layout.content.y }, layout, cam);
}

export function canvasToFrameNorm(
  p: Pt,
  layout: FrameLayout,
  cam: CameraTransform,
  followZoom: boolean,
): Pt {
  const W = layout.frame.width > 0 ? layout.frame.width : 1;
  const H = layout.frame.height > 0 ? layout.frame.height : 1;
  let fx = p.x;
  let fy = p.y;
  if (followZoom) {
    const q = canvasToContentLocal(p, layout, cam);
    fx = q.x + layout.content.x;
    fy = q.y + layout.content.y;
  }
  return { x: (fx - layout.frame.x) / W, y: (fy - layout.frame.y) / H };
}

/** Px-per-normalized-unit scale of the frame on the canvas (x, y). */
export function frameNormScale(layout: FrameLayout, cam: CameraTransform, followZoom: boolean): Pt {
  const k = followZoom ? cam.scale : 1;
  return { x: layout.frame.width * k, y: layout.frame.height * k };
}

/** Content-normalized (0..1) → canvas px without camera (un-zoomed content). */
export function contentNormToCanvas(p: Pt, layout: FrameLayout): Pt {
  return {
    x: layout.content.x + p.x * layout.content.width,
    y: layout.content.y + p.y * layout.content.height,
  };
}

export function canvasToContentNorm(p: Pt, layout: FrameLayout): Pt {
  const w = layout.content.width > 0 ? layout.content.width : 1;
  const h = layout.content.height > 0 ? layout.content.height : 1;
  return { x: (p.x - layout.content.x) / w, y: (p.y - layout.content.y) / h };
}
