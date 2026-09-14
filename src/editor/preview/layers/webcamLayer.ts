import { anchorToPoint } from "../../inspector/controls";
import {
  bubbleCornerRadius,
  bubbleRect,
  fitCrop,
  shapeAspect,
  zoomReactiveScale,
} from "../../inspector/webcam/logic";
import type { CropRect, WebcamSettings, WebcamShape } from "../../inspector/webcam/types";
import type { FrameLayout } from "../layout";
import type { SceneState } from "../scene";
import { type RectPx, clamp, finiteOr, parseColor } from "./geometry";
import type { ContainerLike, GraphicsLike, LayerPixi, SpriteLike } from "./pixiTypes";

/**
 * WebcamBubble (ENGINEERING_SPEC §6.4 / §6.5 / §9.4). Frame-local px on
 * FrameRoot. Margin, border and radius are reference px × `layout.scale`.
 * Zoom-reactive shrink `1/(1+(z-1)*0.5)` pivots on the bubble's anchor so a
 * corner bubble keeps hugging its corner.
 */

/** Placeholder fill when no webcam texture is attached. */
export const WEBCAM_PLACEHOLDER_COLOR = 0x2a2f38;
export const WEBCAM_SHADOW_BLUR = 24;
export const WEBCAM_SHADOW_OFFSET_Y = 8;

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface WebcamLayerInput {
  settings: WebcamSettings;
  /** Timeline visibility regions; empty/undefined = visible the whole time. */
  regions?: readonly TimeRange[] | undefined;
  /** Whether a webcam source exists. */
  hasWebcam: boolean;
  /** Webcam source size in px, when probed. */
  sourceSize?: { width: number; height: number } | null | undefined;
}

export interface WebcamLayerState {
  visible: boolean;
  /** Final bubble rect after zoom-reactive scale, frame-local px. */
  rect: RectPx;
  /** Zoom-reactive scale that was applied (1 when off). */
  scale: number;
  shape: WebcamShape;
  cornerRadius: number;
  mirror: boolean;
  border: { width: number; color: string } | null;
  shadow: { alpha: number; blur: number; offsetY: number } | null;
  /** Source-px crop; null when the source size is unknown and no crop is set. */
  crop: CropRect | null;
  sourceSize: { width: number; height: number } | null;
}

/** Visible when there are no regions, or `tMs` is in any `[startMs, endMs)`. */
export function webcamVisibleAt(regions: readonly TimeRange[] | undefined, tMs: number): boolean {
  if (!regions || regions.length === 0) return true;
  return regions.some((r) => tMs >= r.startMs && tMs < r.endMs);
}

export function evaluateWebcamLayer(
  input: WebcamLayerInput,
  tMs: number,
  layout: FrameLayout,
  camera: Pick<SceneState["camera"], "scale">,
): WebcamLayerState {
  const s = input.settings;
  const k = Number.isFinite(layout.scale) && layout.scale > 0 ? layout.scale : 0;
  const frame = { width: layout.frame.width, height: layout.frame.height };
  const base = bubbleRect(frame, { ...s, marginPx: finiteOr(s.marginPx, 0) * k });
  const scale = zoomReactiveScale(camera.scale, s.zoomReactive);
  const pivot = s.anchor !== null ? anchorToPoint(s.anchor) : { x: 0.5, y: 0.5 };
  const w = base.w * scale;
  const h = base.h * scale;
  const rect: RectPx = {
    x: base.x + (base.w - w) * pivot.x,
    y: base.y + (base.h - h) * pivot.y,
    width: w,
    height: h,
  };
  const src =
    input.sourceSize && input.sourceSize.width > 0 && input.sourceSize.height > 0
      ? { width: input.sourceSize.width, height: input.sourceSize.height }
      : null;
  const crop = s.crop ? { ...s.crop } : src ? fitCrop(src, shapeAspect(s.shape)) : null;
  const borderWidth = Math.max(0, finiteOr(s.borderWidth, 0)) * k * scale;
  const shadowAlpha = clamp(finiteOr(s.shadow, 0), 0, 100) / 100;

  return {
    visible:
      s.enabled && input.hasWebcam && Number.isFinite(tMs) && webcamVisibleAt(input.regions, tMs),
    rect,
    scale,
    shape: s.shape,
    cornerRadius: bubbleCornerRadius(s.shape, finiteOr(s.radius, 0) * k * scale, { w, h }),
    mirror: s.mirror,
    border: borderWidth > 0 ? { width: borderWidth, color: s.borderColor } : null,
    shadow:
      shadowAlpha > 0
        ? {
            alpha: shadowAlpha,
            blur: WEBCAM_SHADOW_BLUR * k * scale,
            offsetY: WEBCAM_SHADOW_OFFSET_Y * k * scale,
          }
        : null,
    crop,
    sourceSize: src,
  };
}

// ── Pixi drawer ──────────────────────────────────────────────────────────────

export interface WebcamLayerDrawer {
  /** Add to FrameRoot above AnnotationLayerFixed. */
  container: ContainerLike;
  /** Attach the stage-owned webcam video sprite (or detach with null). */
  setSprite(sprite: SpriteLike | null): void;
  /**
   * The shadow Graphics: the stage attaches its BlurFilter here (filters are
   * outside this module's pixi surface). Its blur strength is `state.shadow.blur`.
   */
  shadow: GraphicsLike;
  apply(state: WebcamLayerState): void;
  destroy(): void;
}

export function createWebcamLayer(pixi: LayerPixi): WebcamLayerDrawer {
  const container = new pixi.Container({ label: "WebcamBubble" });
  const shadow = new pixi.Graphics({ label: "WebcamShadow" });
  const video = new pixi.Container({ label: "WebcamVideo" });
  const placeholder = new pixi.Graphics({ label: "WebcamPlaceholder" });
  const mask = new pixi.Graphics({ label: "WebcamMask" });
  const border = new pixi.Graphics({ label: "WebcamBorder" });
  video.addChild(placeholder);
  video.mask = mask;
  container.addChild(shadow, video, mask, border);
  let sprite: SpriteLike | null = null;

  return {
    container,
    shadow,
    setSprite(next) {
      if (sprite) video.removeChild(sprite);
      sprite = next;
      if (sprite) video.addChild(sprite);
    },
    apply(state) {
      container.visible = state.visible;
      if (!state.visible) return;
      const { x, y, width: w, height: h } = state.rect;
      const r = state.cornerRadius;

      shadow.clear();
      if (state.shadow) {
        shadow
          .roundRect(x, y + state.shadow.offsetY, w, h, r)
          .fill({ color: 0x000000, alpha: state.shadow.alpha });
      }
      mask.clear().roundRect(x, y, w, h, r).fill({ color: 0xffffff });

      // Mirror flips the video container around the bubble's vertical axis.
      video.scale.set(state.mirror ? -1 : 1, 1);
      video.position.set(state.mirror ? x + w : x, y);

      const hasSource = sprite !== null && state.crop !== null && state.sourceSize !== null;
      placeholder.visible = !hasSource;
      placeholder.clear().rect(0, 0, w, h).fill({ color: WEBCAM_PLACEHOLDER_COLOR });
      if (sprite) {
        sprite.visible = hasSource;
        if (hasSource && state.crop && state.sourceSize) {
          const kx = w / state.crop.w;
          const ky = h / state.crop.h;
          sprite.width = state.sourceSize.width * kx;
          sprite.height = state.sourceSize.height * ky;
          sprite.position.set(-state.crop.x * kx, -state.crop.y * ky);
        }
      }

      border.clear();
      if (state.border) {
        const c = parseColor(state.border.color, 0xffffff);
        const i = state.border.width / 2;
        border
          .roundRect(
            x + i,
            y + i,
            Math.max(0, w - state.border.width),
            Math.max(0, h - state.border.width),
            Math.max(0, r - i),
          )
          .stroke({ color: c.color, alpha: c.alpha, width: state.border.width });
      }
    },
    destroy() {
      if (sprite) video.removeChild(sprite);
      sprite = null;
      container.destroy({ children: true });
    },
  };
}
