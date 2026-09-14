import type { CursorSettings, CursorStyle } from "../inspector/cursor/types";
import type { FrameBackground, FrameSettings, Size } from "../inspector/frame/types";
import type { ZoomRegion } from "../inspector/zoom/types";
import {
  type CameraTransform,
  type CursorPositionSource,
  type Point,
  cameraTransform,
  focusAt,
  zoomLevelAt,
} from "./camera";
import { type FrameLayout, computeFrameLayout } from "./layout";

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
  background: { paint: BackgroundPaint; blur: number };
  camera: CameraTransform & { level: number; regionId: string | null; focus: Point };
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
 * Placeholder paint for a wallpaper id. Bundled wallpaper images
 * (`public/wallpapers/*.jpg`, §9.1) have not shipped yet, so each id maps to
 * a deterministic two-stop diagonal gradient derived from its hash. Replace
 * with the real wallpaper sprite once the pack lands.
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

export function resolveBackgroundPaint(bg: FrameBackground): BackgroundPaint {
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
    case "wallpaper":
      return wallpaperFallbackPaint(bg.wallpaperId);
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
  const { frame, cursor, cursorTrack } = input;
  const layout = computeFrameLayout(input.canvas, frame, input.sourceSize);
  const contentW = layout.content.width;
  const contentH = layout.content.height;

  const { level, region } = zoomLevelAt(input.zoomRegions, t);
  const focus = region ? focusAt(region, t, cursorTrack) : { x: 0.5, y: 0.5 };
  const cam = cameraTransform({ level, focus, contentW, contentH });

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
      size: (CURSOR_BASE_PX * pct * layout.scale) / cam.scale,
      style: cursor.style,
    };
  }

  const bgPaint = resolveBackgroundPaint(frame.background);
  const blurs = frame.background.kind === "wallpaper" || frame.background.kind === "image";

  return {
    tMs: t,
    layout,
    background: { paint: bgPaint, blur: blurs ? layout.backgroundBlur : 0 },
    camera: { ...cam, level: cam.scale, regionId: region?.id ?? null, focus },
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
