import { ANCHORS, anchorToPoint, clamp, type Anchor } from "../controls";
import type { Focus, FocusMode } from "../../autozoom";
import {
  EASE_MS_MAX,
  MIN_ZOOM_REGION_MS,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  type ZoomCurve,
  type ZoomRegion,
} from "./types";

/**
 * Pure region-edit helpers for the Zoom inspector. Every edit returns a new
 * region marked `source: "manual"` (§8: edited suggestions survive regenerate).
 * Non-finite input leaves the region unchanged.
 */

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function edited(region: ZoomRegion, patch: Partial<ZoomRegion>): ZoomRegion {
  return { ...region, ...patch, source: "manual" };
}

export function regionDurationMs(region: ZoomRegion): number {
  return Math.max(0, region.endMs - region.startMs);
}

/** Zoom level clamped to 1.0–4.0×, rounded to 2 decimals. */
export function setLevel(region: ZoomRegion, level: number): ZoomRegion {
  if (!Number.isFinite(level)) return region;
  return edited(region, { level: round(clamp(level, ZOOM_LEVEL_MIN, ZOOM_LEVEL_MAX), 2) });
}

/** Start clamped to `[0, endMs - MIN_ZOOM_REGION_MS]`. */
export function setStartMs(region: ZoomRegion, startMs: number): ZoomRegion {
  if (!Number.isFinite(startMs)) return region;
  const max = Math.max(0, region.endMs - MIN_ZOOM_REGION_MS);
  return edited(region, { startMs: Math.round(clamp(startMs, 0, max)) });
}

/**
 * End clamped to `[startMs + MIN_ZOOM_REGION_MS, timelineDurationMs]`. The
 * minimum length wins if the region already starts too close to the end.
 */
export function setEndMs(region: ZoomRegion, endMs: number, timelineDurationMs: number): ZoomRegion {
  if (!Number.isFinite(endMs)) return region;
  const min = region.startMs + MIN_ZOOM_REGION_MS;
  const max = Math.max(min, timelineDurationMs);
  return edited(region, { endMs: Math.round(clamp(endMs, min, max)) });
}

export function setEaseMs(region: ZoomRegion, which: "easeInMs" | "easeOutMs", ms: number): ZoomRegion {
  if (!Number.isFinite(ms)) return region;
  return edited(region, { [which]: Math.round(clamp(ms, 0, EASE_MS_MAX)) });
}

export function setCurve(region: ZoomRegion, curve: ZoomCurve): ZoomRegion {
  return edited(region, { curve });
}

export function setFocusMode(region: ZoomRegion, mode: FocusMode): ZoomRegion {
  return edited(region, { focus: { ...region.focus, mode } });
}

/** Focus point in normalized 0..1 content coords (clamped). */
export function setFocusPoint(region: ZoomRegion, x: number, y: number): ZoomRegion {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return region;
  return edited(region, { focus: { ...region.focus, x: clamp(x, 0, 1), y: clamp(y, 0, 1) } });
}

/** Picking a 3×3 cell pins the focus there (mode `fixed`). */
export function setFocusAnchor(region: ZoomRegion, anchor: Anchor): ZoomRegion {
  const p = anchorToPoint(anchor);
  return edited(region, { focus: { mode: "fixed", x: p.x, y: p.y } });
}

/** The anchor cell matching a focus point, or `null` for a custom position. */
export function focusToAnchor(focus: Focus): Anchor | null {
  const eps = 1e-3;
  return (
    ANCHORS.find((a) => {
      const p = anchorToPoint(a);
      return Math.abs(p.x - focus.x) < eps && Math.abs(p.y - focus.y) < eps;
    }) ?? null
  );
}

export function deleteRegion(regions: readonly ZoomRegion[], id: string): ZoomRegion[] {
  return regions.filter((r) => r.id !== id);
}

/**
 * Copy region `id` with `newId`, placed in the first gap at or after the
 * original's end that fits its length without overlapping another region.
 * Returns the new list sorted by start, or `null` when the region is missing or
 * no gap fits before `timelineDurationMs`.
 */
export function duplicateRegion(
  regions: readonly ZoomRegion[],
  id: string,
  timelineDurationMs: number,
  newId: string,
): ZoomRegion[] | null {
  const original = regions.find((r) => r.id === id);
  if (!original) return null;
  const length = regionDurationMs(original);
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);

  let start = original.endMs;
  for (const r of sorted) {
    if (r.endMs <= start) continue;
    if (r.startMs >= start + length) break;
    start = r.endMs;
  }
  if (start + length > timelineDurationMs) return null;

  const copy: ZoomRegion = {
    ...original,
    id: newId,
    startMs: start,
    endMs: start + length,
    source: "manual",
    reason: undefined,
  };
  return [...sorted, copy].sort((a, b) => a.startMs - b.startMs);
}

/** Eased progress 0→1 for `t` in 0..1. Spring is a damped sine and overshoots. */
export function easeValue(curve: ZoomCurve, t: number): number {
  const x = clamp(t, 0, 1);
  switch (curve) {
    case "linear":
      return x;
    case "ease-out-cubic":
      return 1 - (1 - x) ** 3;
    case "spring":
      return x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(3 * Math.PI * x);
  }
}

export interface CurveSample {
  t: number;
  v: number;
}

/** Evenly spaced samples (inclusive of both ends) for the curve preview. */
export function sampleCurve(curve: ZoomCurve, count = 24): CurveSample[] {
  const n = Math.max(2, Math.floor(count));
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { t, v: easeValue(curve, t) };
  });
}

/** SVG path for samples in a `width`×`height` box; y range widens for overshoot. */
export function curvePath(samples: readonly CurveSample[], width: number, height: number, pad = 2): string {
  const lo = Math.min(0, ...samples.map((s) => s.v));
  const hi = Math.max(1, ...samples.map((s) => s.v));
  const w = width - pad * 2;
  const h = height - pad * 2;
  return samples
    .map((s, i) => {
      const x = pad + s.t * w;
      const y = pad + (1 - (s.v - lo) / (hi - lo)) * h;
      return `${i === 0 ? "M" : "L"}${round(x, 2)} ${round(y, 2)}`;
    })
    .join(" ");
}

/** "mm:ss.cc" (or "h:mm:ss.cc" past an hour) for mono timing fields. */
export function formatTimecode(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 10)) : 0;
  const cs = safe % 100;
  const totalS = Math.floor(safe / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const core = `${pad(m)}:${pad(s)}.${pad(cs)}`;
  return h > 0 ? `${h}:${core}` : core;
}

/** Parse "ss(.fff)", "m:ss(.fff)" or "h:mm:ss(.fff)" to ms; `null` if invalid. */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  if (!/^(\d+:){0,2}\d+(\.\d+)?$/.test(trimmed)) return null;
  const parts = trimmed.split(":");
  const seconds = Number(parts.pop());
  const minutes = parts.length > 0 ? Number(parts.pop()) : 0;
  const hours = parts.length > 0 ? Number(parts.pop()) : 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}
