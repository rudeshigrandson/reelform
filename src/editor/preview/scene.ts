import type { CursorSettings, CursorStyle } from "../inspector/cursor/types";
import type { EffectsSettings } from "../inspector/effects/types";
import type { FrameBackground, FrameSettings, Size } from "../inspector/frame/types";
import type { CameraSettings, ZoomRegion } from "../inspector/zoom/types";
import {
  type CameraTransform,
  type CursorPositionSource,
  PARALLAX_OVERSCAN,
  type Point,
  TILT_DT_MS,
  cameraTilt,
  cameraTransform,
  followFocusAt,
  parallaxOffset,
  zoomLevelAt,
} from "./camera";
import type { SceneComposition } from "./compose";
import { type FrameLayout, computeFrameLayout } from "./layout";
import { type SceneTransitionInput, type TransitionState, transitionAt } from "./transitions";
import type { MeshPoint, WallpaperRegistry } from "./wallpapers";
import { wallpaperPaint } from "./wallpapers";

/**
 * Scene evaluation — the pure half of `SceneBuilder.update(tMs)` (§6.4).
 * Produces a plain `SceneState` the Pixi adapter applies verbatim; the same
 * evaluation will drive export. No Date.now, no randomness, no frame deltas.
 */

/** Cursor sprite base size in output pixels at 100% (§6.6). */
export const CURSOR_BASE_PX = 32;

export interface SceneInput {
  /** Canvas size in CSS px. */
  canvas: Size;
  frame: FrameSettings;
  sourceSize: Size | null | undefined;
  zoomRegions: readonly ZoomRegion[];
  cursor: CursorSettings;
  cursorTrack?: CursorPositionSource | null | undefined;
  /** Whether a playable video is attached (otherwise a placeholder is drawn). */
  hasVideo: boolean;
  /** Procedural wallpapers by id; unknown ids use `wallpaperFallbackPaint`. */
  wallpapers?: WallpaperRegistry | null | undefined;
  /**
   * Timeline → source time for telemetry lookups (cursor, follow focus).
   * Omitted = identity (untrimmed timeline).
   */
  sourceTimeAt?: ((timelineMs: number) => number) | undefined;
  /** Follow-focus smoothing + speed limit; omitted = project defaults. */
  camera?: CameraSettings | undefined;
  /** `effects.motion`: 3D tilt on zooms and parallax background. */
  cameraMotion?: EffectsSettings["motion"] | undefined;
  /** Clip-boundary transition (cut-with-zoom bump, cross-dissolve mix). */
  transition?: SceneTransitionInput | undefined;
}

export interface PaintStop {
  /** 0..1 along the gradient axis. */
  offset: number;
  color: string;
}

export type BackgroundPaint =
  | { kind: "transparent" }
  | { kind: "solid"; color: string }
  | { kind: "linear-gradient"; angle: number; stops: PaintStop[] }
  | { kind: "radial-gradient"; stops: PaintStop[] }
  /** Procedural mesh: `base` fill plus soft radial color blobs. */
  | { kind: "mesh"; base: string; points: MeshPoint[] }
  /** User image; adapters paint `fallbackColor` until the asset resolves. */
  | { kind: "image"; path: string; fit: "fit" | "fill"; fallbackColor: string };

export interface CursorState {
  visible: boolean;
  /** Content-local px (inside CameraContainer). */
  x: number;
  y: number;
  /** Sprite height in content-local px (already × 1/zoom). */
  size: number;
  style: CursorStyle;
}

export interface SceneState {
  tMs: number;
  layout: FrameLayout;
  /** `offsetX/Y` (px) + `scale` (overscan, around the frame center) come from parallax. */
  background: {
    paint: BackgroundPaint;
    blur: number;
    offsetX: number;
    offsetY: number;
    scale: number;
  };
  /** `tiltX/Y`: CameraContainer skew in radians (3D tilt); 0 when off. */
  camera: CameraTransform & {
    level: number;
    regionId: string | null;
    focus: Point;
    tiltX: number;
    tiltY: number;
  };
  /** Active clip-boundary transition, or null. */
  transition: TransitionState | null;
  content: {
    radius: number;
    squircle: boolean;
    border: { width: number; color: string; alpha: number };
    shadow: { color: string; alpha: number; offsetY: number; blur: number };
  };
  video: {
    visible: boolean;
    crop: { x: number; y: number; width: number; height: number } | null;
  };
  cursor: CursorState;
  /**
   * Remaining §6.4 layers (annotations, captions, webcam, title cards, cursor
   * effects, color). Set by `composeScene`; absent → base layers only.
   */
  composition?: SceneComposition | undefined;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const safeColor = (c: string, fallback = "#000000"): string => (HEX.test(c) ? c : fallback);

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** FNV-1a 32-bit — stable across runs and platforms. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Placeholder paint for a wallpaper id missing from the manifest: a
 * deterministic two-stop diagonal gradient derived from its hash.
 */
export function wallpaperFallbackPaint(wallpaperId: string): BackgroundPaint {
  const h = hashString(wallpaperId);
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >>> 9) % 60)) % 360;
  return {
    kind: "linear-gradient",
    angle: 135,
    stops: [
      { offset: 0, color: hslToHex(hue, 0.55, 0.42) },
      { offset: 1, color: hslToHex(hue2, 0.6, 0.28) },
    ],
  };
}

export function resolveBackgroundPaint(
  bg: FrameBackground,
  wallpapers?: WallpaperRegistry | null | undefined,
): BackgroundPaint {
  switch (bg.kind) {
    case "none":
      return { kind: "transparent" };
    case "color":
      return { kind: "solid", color: safeColor(bg.color) };
    case "gradient": {
      const stops = [...bg.gradient.stops]
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          offset: Math.min(1, Math.max(0, (Number.isFinite(s.position) ? s.position : 0) / 100)),
          color: safeColor(s.color),
        }));
      return bg.gradient.type === "radial"
        ? { kind: "radial-gradient", stops }
        : {
            kind: "linear-gradient",
            angle: Number.isFinite(bg.gradient.angle) ? bg.gradient.angle : 0,
            stops,
          };
    }
    case "wallpaper": {
      const def = wallpapers?.get(bg.wallpaperId);
      return def ? wallpaperPaint(def) : wallpaperFallbackPaint(bg.wallpaperId);
    }
    case "image":
      return bg.image.path === null
        ? { kind: "solid", color: safeColor(bg.color) }
        : {
            kind: "image",
            path: bg.image.path,
            fit: bg.image.fit,
            fallbackColor: safeColor(bg.color),
          };
  }
}

export function evaluateScene(input: SceneInput, tMs: number): SceneState {
  const t = Number.isFinite(tMs) ? tMs : 0;
  const { frame, cursor } = input;
  const toSource = input.sourceTimeAt;
  const cursorTrack: CursorPositionSource | null | undefined =
    toSource && input.cursorTrack
      ? {
          positionAt: (ms) => (input.cursorTrack as CursorPositionSource).positionAt(toSource(ms)),
        }
      : input.cursorTrack;
  const layout = computeFrameLayout(input.canvas, frame, input.sourceSize);
  const contentW = layout.content.width;
  const contentH = layout.content.height;
  const transition = transitionAt(input.transition, t);

  const cameraAt = (at: number) => {
    const { level: z, region: r } = zoomLevelAt(input.zoomRegions, at);
    const f = r
      ? followFocusAt(r, at, input.cursorTrack, input.camera, toSource)
      : { x: 0.5, y: 0.5 };
    const bump = transitionAt(input.transition, at)?.zoom ?? 1;
    return {
      region: r,
      focus: f,
      cam: cameraTransform({ level: z * bump, focus: f, contentW, contentH }),
    };
  };
  const { region, focus, cam } = cameraAt(t);

  let tilt = { x: 0, y: 0 };
  if (input.cameraMotion?.tilt3d && contentW > 0 && contentH > 0 && cam.scale > 1) {
    const a = cameraAt(t - TILT_DT_MS).cam;
    const b = cameraAt(t + TILT_DT_MS).cam;
    const dtS = (2 * TILT_DT_MS) / 1000;
    tilt = cameraTilt(
      (b.pivotX - a.pivotX) / contentW / dtS,
      (b.pivotY - a.pivotY) / contentH / dtS,
      cam.scale,
    );
  }
  const parallax = input.cameraMotion?.parallax ? parallaxOffset(cam) : null;

  const crop = frame.crop ? { ...frame.crop } : null;
  let cursorState: CursorState = { visible: false, x: 0, y: 0, size: 0, style: cursor.style };
  if (cursor.show && cursorTrack) {
    const p = cursorTrack.positionAt(t);
    // Telemetry is normalized to the full source; map through the crop.
    const cx = crop && crop.width > 0 ? (p.x - crop.x) / crop.width : p.x;
    const cy = crop && crop.height > 0 ? (p.y - crop.y) / crop.height : p.y;
    const pct = Number.isFinite(cursor.size) ? cursor.size / 100 : 1;
    cursorState = {
      visible: Number.isFinite(cx) && Number.isFinite(cy),
      x: (Number.isFinite(cx) ? cx : 0) * contentW,
      y: (Number.isFinite(cy) ? cy : 0) * contentH,
      // Default keeps apparent size while zoomed; "scale with zoom" lets it grow (§6.6).
      size: (CURSOR_BASE_PX * pct * layout.scale) / (cursor.scaleWithZoom ? 1 : cam.scale),
      style: cursor.style,
    };
  }

  const bgPaint = resolveBackgroundPaint(frame.background, input.wallpapers);
  const blurs = frame.background.kind === "wallpaper" || frame.background.kind === "image";

  return {
    tMs: t,
    layout,
    background: {
      paint: bgPaint,
      blur: blurs ? layout.backgroundBlur : 0,
      offsetX: parallax?.x ?? 0,
      offsetY: parallax?.y ?? 0,
      scale: parallax ? PARALLAX_OVERSCAN : 1,
    },
    camera: {
      ...cam,
      level: cam.scale,
      regionId: region?.id ?? null,
      focus,
      tiltX: tilt.x,
      tiltY: tilt.y,
    },
    transition,
    content: {
      radius: layout.radius,
      squircle: frame.squircle,
      border: {
        width: layout.borderWidth,
        color: safeColor(frame.border.color, "#ffffff"),
        alpha: Math.min(1, Math.max(0, frame.border.opacity / 100)),
      },
      shadow: {
        color: safeColor(frame.shadow.color),
        alpha: Math.min(1, Math.max(0, frame.shadow.strength / 100)),
        offsetY: layout.shadowOffsetY,
        blur: layout.shadowBlur,
      },
    },
    video: { visible: input.hasVideo, crop },
    cursor: cursorState,
  };
}
