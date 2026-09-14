import { clamp } from "../controls";
import {
  FRAME_LIMITS,
  type AspectPreset,
  type FrameAspect,
  type FrameGradient,
  type FramePadding,
  type FramePreset,
  type FrameSettings,
  type Size,
} from "./types";

/** Pure Frame-tab logic: presets, aspect → output size, padding modes, gradient stops, clamping. */

const lim = (n: number, r: { min: number; max: number }): number => clamp(Number.isFinite(n) ? n : r.min, r.min, r.max);

/** Returns a copy with every numeric field clamped to its S13 range. */
export function clampFrameSettings(s: FrameSettings): FrameSettings {
  const p = s.padding;
  const L = FRAME_LIMITS;
  const stops = [...s.background.gradient.stops]
    .slice(0, L.gradientStops.max)
    .map((st) => ({ color: st.color, position: lim(st.position, { min: 0, max: 100 }) }));
  return {
    ...s,
    background: {
      ...s.background,
      gradient: { ...s.background.gradient, angle: lim(s.background.gradient.angle, L.gradientAngle), stops },
      image: { ...s.background.image },
    },
    blur: lim(s.blur, L.blur),
    padding: {
      matchAll: p.matchAll,
      all: lim(p.all, L.padding),
      top: lim(p.top, L.padding),
      right: lim(p.right, L.padding),
      bottom: lim(p.bottom, L.padding),
      left: lim(p.left, L.padding),
    },
    radius: lim(s.radius, L.radius),
    shadow: {
      ...s.shadow,
      strength: lim(s.shadow.strength, L.shadowStrength),
      offsetY: lim(s.shadow.offsetY, L.shadowOffsetY),
      blur: lim(s.shadow.blur, L.shadowBlur),
    },
    border: { ...s.border, width: lim(s.border.width, L.borderWidth), opacity: lim(s.border.opacity, L.borderOpacity) },
    aspect: {
      ...s.aspect,
      customWidth: Math.round(lim(s.aspect.customWidth, L.customSize)),
      customHeight: Math.round(lim(s.aspect.customHeight, L.customSize)),
    },
    inset: lim(s.inset, L.inset),
    crop: s.crop ? { ...s.crop } : null,
  };
}

/** Applies a preset as a single command. The source crop is recording-specific and is kept. */
export function applyPreset(current: FrameSettings, preset: FramePreset): FrameSettings {
  return clampFrameSettings({ ...structuredClone(preset.settings), crop: current.crop ? { ...current.crop } : null });
}

/** Deep equality of everything a preset controls (crop excluded). */
export function matchesPreset(s: FrameSettings, preset: FramePreset): boolean {
  const strip = (x: FrameSettings) => JSON.stringify({ ...x, crop: null });
  return strip(s) === strip(preset.settings);
}

/** Id of the first preset the settings match, or null when customized. */
export function findMatchingPreset(s: FrameSettings, presets: readonly FramePreset[]): string | null {
  return presets.find((p) => matchesPreset(s, p))?.id ?? null;
}

const RATIOS: Record<Exclude<AspectPreset, "source" | "custom">, [number, number]> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
  "1:1": [1, 1],
  "4:3": [4, 3],
  "4:5": [4, 5],
  "21:9": [21, 9],
};

/** Output width / height, or null when the source size is unknown for "source". */
export function aspectRatio(aspect: FrameAspect, source: Size | null | undefined): number | null {
  if (aspect.preset === "custom") return aspect.customWidth / aspect.customHeight;
  if (aspect.preset === "source") return source && source.width > 0 && source.height > 0 ? source.width / source.height : null;
  const [w, h] = RATIOS[aspect.preset];
  return w / h;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/**
 * Output pixel size. Ratio presets use a 1080px short edge; Source uses the
 * recording size; Custom uses W×H. Dimensions are rounded to even (H.264).
 * Falls back to 1920×1080 when Source is requested without a known size.
 */
export function outputSize(aspect: FrameAspect, source: Size | null | undefined, shortEdge = 1080): Size {
  if (aspect.preset === "custom") return { width: even(aspect.customWidth), height: even(aspect.customHeight) };
  if (aspect.preset === "source") {
    if (!source || source.width <= 0 || source.height <= 0) return { width: 1920, height: 1080 };
    return { width: even(source.width), height: even(source.height) };
  }
  const [w, h] = RATIOS[aspect.preset];
  return w >= h
    ? { width: even((shortEdge * w) / h), height: even(shortEdge) }
    : { width: even(shortEdge), height: even((shortEdge * h) / w) };
}

export type CustomSizeResult = { ok: true; width: number; height: number } | { ok: false; error: string };

/** Validates raw Custom W×H text input. */
export function validateCustomSize(widthText: string, heightText: string): CustomSizeResult {
  const { min, max } = FRAME_LIMITS.customSize;
  const parse = (t: string): number | null => (/^\s*\d+\s*$/.test(t) ? Number(t) : null);
  const w = parse(widthText);
  const h = parse(heightText);
  if (w === null || h === null) return { ok: false, error: "Width and height must be whole numbers" };
  if (w < min || w > max || h < min || h > max) return { ok: false, error: `Size must be between ${min} and ${max} px` };
  return { ok: true, width: w, height: h };
}

/** Effective per-side padding. */
export function resolvePadding(p: FramePadding): { top: number; right: number; bottom: number; left: number } {
  return p.matchAll ? { top: p.all, right: p.all, bottom: p.all, left: p.all } : { top: p.top, right: p.right, bottom: p.bottom, left: p.left };
}

/**
 * Toggles "Match all sides". Turning it off seeds T/R/B/L from the uniform
 * value (no visual jump); turning it on adopts the top side as the uniform value.
 */
export function setPaddingMatchAll(p: FramePadding, matchAll: boolean): FramePadding {
  if (matchAll === p.matchAll) return p;
  if (!matchAll) return { matchAll, all: p.all, top: p.all, right: p.all, bottom: p.all, left: p.all };
  return { matchAll, all: p.top, top: p.top, right: p.top, bottom: p.top, left: p.top };
}

export function setPaddingAll(p: FramePadding, value: number): FramePadding {
  const v = lim(value, FRAME_LIMITS.padding);
  return { ...p, all: v, top: v, right: v, bottom: v, left: v };
}

export type PaddingSide = "top" | "right" | "bottom" | "left";

export function setPaddingSide(p: FramePadding, side: PaddingSide, value: number): FramePadding {
  return { ...p, [side]: lim(value, FRAME_LIMITS.padding) };
}

/** Adds a stop in the middle of the widest gap; no-op at the 4-stop limit. */
export function addGradientStop(g: FrameGradient): FrameGradient {
  if (g.stops.length >= FRAME_LIMITS.gradientStops.max) return g;
  const sorted = [...g.stops].sort((a, b) => a.position - b.position);
  let gapIdx = 0;
  let gap = -1;
  for (let i = 0; i < sorted.length - 1; i++) {
    const d = (sorted[i + 1]?.position ?? 0) - (sorted[i]?.position ?? 0);
    if (d > gap) {
      gap = d;
      gapIdx = i;
    }
  }
  const left = sorted[gapIdx];
  const right = sorted[gapIdx + 1];
  if (!left || !right) return g;
  const stop = { color: left.color, position: Math.round((left.position + right.position) / 2) };
  return { ...g, stops: [...sorted.slice(0, gapIdx + 1), stop, ...sorted.slice(gapIdx + 1)] };
}

/** Removes a stop; no-op at the 2-stop minimum or for an out-of-range index. */
export function removeGradientStop(g: FrameGradient, index: number): FrameGradient {
  if (g.stops.length <= FRAME_LIMITS.gradientStops.min || index < 0 || index >= g.stops.length) return g;
  return { ...g, stops: g.stops.filter((_, i) => i !== index) };
}

export function updateGradientStop(g: FrameGradient, index: number, patch: Partial<{ color: string; position: number }>): FrameGradient {
  if (index < 0 || index >= g.stops.length) return g;
  return {
    ...g,
    stops: g.stops.map((s, i) =>
      i === index
        ? { color: patch.color ?? s.color, position: patch.position === undefined ? s.position : lim(patch.position, { min: 0, max: 100 }) }
        : s,
    ),
  };
}

/** CSS preview of a gradient (for the editor swatch only; the renderer draws its own). */
export function gradientToCss(g: FrameGradient): string {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${s.position}%`)
    .join(", ");
  return g.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${g.angle}deg, ${stops})`;
}
