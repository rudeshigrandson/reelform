import {
  type CameraSettings,
  DEFAULT_ZOOM_SETTINGS,
  type ZoomRegion,
} from "../inspector/zoom/types";
import { easeValue } from "../inspector/zoom/zoomLogic";
import { OneEuroFilter } from "./oneEuro";

/**
 * Camera / zoom math — ENGINEERING_SPEC §6.5. Pure and deterministic: every
 * value is a function of the regions + `tMs` (no frame deltas, no Date.now).
 */

/** Anything that can report a normalized (0..1) cursor position for a time. */
export interface CursorPositionSource {
  positionAt(tMs: number): { x: number; y: number };
}

export interface Point {
  x: number;
  y: number;
}

export interface ZoomSample {
  level: number;
  region: ZoomRegion | null;
}

const finiteOr = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * The region active at `tMs` (inclusive of both ends). The model disallows
 * overlaps; if some slip through, the region with the latest `startMs` that
 * contains `t` wins (ties → the later entry in the array).
 */
export function activeRegionAt(regions: readonly ZoomRegion[], tMs: number): ZoomRegion | null {
  let best: ZoomRegion | null = null;
  for (const r of regions) {
    if (!(r.endMs > r.startMs) || tMs < r.startMs || tMs > r.endMs) continue;
    if (best === null || r.startMs >= best.startMs) best = r;
  }
  return best;
}

/**
 * Zoom level `z(t)`: eases 1 → level over `easeInMs` from `startMs`, holds,
 * then eases level → 1 over `easeOutMs` ending exactly at `endMs`. When the
 * two ease durations exceed the region length both are scaled down
 * proportionally. Spring may overshoot above `level` on the way in; the
 * result is floored at 1 because a level below 1 would reveal content edges.
 * Outside every region the level is 1.
 */
export function zoomLevelAt(regions: readonly ZoomRegion[], tMs: number): ZoomSample {
  if (!Number.isFinite(tMs)) return { level: 1, region: null };
  const region = activeRegionAt(regions, tMs);
  if (!region) return { level: 1, region: null };

  const target = Math.max(1, finiteOr(region.level, 1));
  const length = region.endMs - region.startMs;
  let easeIn = Math.max(0, finiteOr(region.easeInMs, 0));
  let easeOut = Math.max(0, finiteOr(region.easeOutMs, 0));
  if (easeIn + easeOut > length) {
    const k = length / (easeIn + easeOut);
    easeIn *= k;
    easeOut *= k;
  }

  let level = target;
  const outStart = region.endMs - easeOut;
  if (easeIn > 0 && tMs < region.startMs + easeIn) {
    const p = (tMs - region.startMs) / easeIn;
    level = 1 + (target - 1) * easeValue(region.curve, p);
  } else if (easeOut > 0 && tMs > outStart) {
    const p = (tMs - outStart) / easeOut;
    level = target + (1 - target) * easeValue(region.curve, p);
  }
  return { level: Math.max(1, level), region };
}

/**
 * Focus point `f(t)` in normalized content coords. `fixed` → the region's
 * point; `follow` → the smoothed cursor position (falls back to the region's
 * point when no cursor track exists). Always clamped to 0..1.
 */
export function focusAt(
  region: ZoomRegion,
  tMs: number,
  cursor?: CursorPositionSource | null | undefined,
): Point {
  const fallback = { x: finiteOr(region.focus.x, 0.5), y: finiteOr(region.focus.y, 0.5) };
  let p = fallback;
  if (region.focus.mode === "follow" && cursor) {
    const c = cursor.positionAt(tMs);
    p = { x: finiteOr(c.x, fallback.x), y: finiteOr(c.y, fallback.y) };
  }
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

// ── Follow focus (§6.5: one-euro on `camera.smoothing`, velocity ≤ maxZoomSpeed) ──

/** Grid the follow path is precomputed on. */
export const FOLLOW_SAMPLE_HZ = 120;
export const FOLLOW_SAMPLE_MS = 1000 / FOLLOW_SAMPLE_HZ;
/** One-euro min cutoff at `camera.smoothing` 0 (snappy) and 1 (silky). */
export const FOLLOW_SNAPPY_CUTOFF_HZ = 4;
export const FOLLOW_SILKY_CUTOFF_HZ = 0.25;
const FOLLOW_BETA = 0.6;
const FOLLOW_D_CUTOFF_HZ = 1;
/** Pan speed (normalized content units / s) allowed per unit of `maxZoomSpeed`. */
export const FOLLOW_SPEED_PER_ZOOM_SPEED = 0.25;

/** `camera.smoothing` (0..1) → one-euro min cutoff, linear from snappy to silky. */
export function followMinCutoff(smoothing: number): number {
  const s = clamp(finiteOr(smoothing, 0.5), 0, 1);
  return FOLLOW_SNAPPY_CUTOFF_HZ + (FOLLOW_SILKY_CUTOFF_HZ - FOLLOW_SNAPPY_CUTOFF_HZ) * s;
}

/** Max focus speed (normalized units / s) for a `maxZoomSpeed` setting. */
export function maxFollowSpeed(maxZoomSpeed: number): number {
  const v = finiteOr(maxZoomSpeed, DEFAULT_ZOOM_SETTINGS.camera.maxZoomSpeed);
  return Math.max(0, v) * FOLLOW_SPEED_PER_ZOOM_SPEED;
}

/** A precomputed camera path on the follow grid; linear between samples, clamped at the ends. */
export class CameraFollowPath {
  constructor(
    readonly startMs: number,
    private readonly xs: Float64Array,
    private readonly ys: Float64Array,
  ) {}

  get length(): number {
    return this.xs.length;
  }

  positionAt(tMs: number): Point {
    const n = this.xs.length;
    if (n === 0) return { x: 0.5, y: 0.5 };
    const rel = (finiteOr(tMs, this.startMs) - this.startMs) / FOLLOW_SAMPLE_MS;
    if (rel <= 0) return { x: this.xs[0] as number, y: this.ys[0] as number };
    if (rel >= n - 1) return { x: this.xs[n - 1] as number, y: this.ys[n - 1] as number };
    const i = Math.floor(rel);
    const u = rel - i;
    const x0 = this.xs[i] as number;
    const y0 = this.ys[i] as number;
    return {
      x: x0 + ((this.xs[i + 1] as number) - x0) * u,
      y: y0 + ((this.ys[i + 1] as number) - y0) * u,
    };
  }
}

/**
 * Sample `source` on the follow grid over `[startMs, endMs]`, one-euro filter
 * each channel, then clamp the per-step displacement to `maxFollowSpeed`.
 * Starts exactly on the source position at `startMs`, so the path is a pure
 * function of (source, range, settings).
 */
export function buildCameraFollowPath(
  source: (tMs: number) => Point,
  startMs: number,
  endMs: number,
  settings: CameraSettings,
): CameraFollowPath {
  const start = finiteOr(startMs, 0);
  const span = Math.max(0, finiteOr(endMs, start) - start);
  const n = Math.floor(span / FOLLOW_SAMPLE_MS) + 2;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const config = {
    minCutoff: followMinCutoff(settings.smoothing),
    beta: FOLLOW_BETA,
    dCutoff: FOLLOW_D_CUTOFF_HZ,
  };
  const fx = new OneEuroFilter(config);
  const fy = new OneEuroFilter(config);
  const maxStep = (maxFollowSpeed(settings.maxZoomSpeed) * FOLLOW_SAMPLE_MS) / 1000;
  let px = 0.5;
  let py = 0.5;
  for (let i = 0; i < n; i++) {
    const t = start + i * FOLLOW_SAMPLE_MS;
    const raw = source(t);
    const sx = fx.filter(t / 1000, clamp(finiteOr(raw.x, px), 0, 1));
    const sy = fy.filter(t / 1000, clamp(finiteOr(raw.y, py), 0, 1));
    if (i > 0) {
      const dx = sx - px;
      const dy = sy - py;
      const d = Math.hypot(dx, dy);
      const k = d > maxStep ? maxStep / d : 1;
      px += dx * k;
      py += dy * k;
    } else {
      px = sx;
      py = sy;
    }
    xs[i] = px;
    ys[i] = py;
  }
  return new CameraFollowPath(start, xs, ys);
}

const identityTime = (t: number): number => t;
/** Paths per cursor track → time mapping → region/settings key. */
const followCache = new WeakMap<
  object,
  WeakMap<(t: number) => number, Map<string, CameraFollowPath>>
>();
const FOLLOW_CACHE_LIMIT = 64;

/**
 * Follow path for a region, cached per (cursor track, time mapping, region
 * range + fallback focus, camera settings). `toSource` maps timeline → source
 * time for telemetry lookups; pass a stable function to keep cache hits.
 */
export function cameraFollowPath(
  region: ZoomRegion,
  cursor: CursorPositionSource,
  settings: CameraSettings = DEFAULT_ZOOM_SETTINGS.camera,
  toSource?: ((timelineMs: number) => number) | undefined,
): CameraFollowPath {
  const map = toSource ?? identityTime;
  let byMapping = followCache.get(cursor);
  if (!byMapping) {
    byMapping = new WeakMap();
    followCache.set(cursor, byMapping);
  }
  let paths = byMapping.get(map);
  if (!paths) {
    paths = new Map();
    byMapping.set(map, paths);
  }
  const fb = { x: finiteOr(region.focus.x, 0.5), y: finiteOr(region.focus.y, 0.5) };
  const key = [
    region.startMs,
    region.endMs,
    fb.x,
    fb.y,
    settings.smoothing,
    settings.maxZoomSpeed,
  ].join("|");
  const hit = paths.get(key);
  if (hit) return hit;
  const path = buildCameraFollowPath(
    (t) => {
      const c = cursor.positionAt(map(t));
      return { x: finiteOr(c.x, fb.x), y: finiteOr(c.y, fb.y) };
    },
    region.startMs,
    region.endMs,
    settings,
  );
  if (paths.size >= FOLLOW_CACHE_LIMIT) paths.clear();
  paths.set(key, path);
  return path;
}

/**
 * Focus with the camera follow evaluator: `follow` regions read the cached
 * smoothed, speed-limited path; `fixed` (or no cursor) behaves like `focusAt`.
 */
export function followFocusAt(
  region: ZoomRegion,
  tMs: number,
  cursor?: CursorPositionSource | null | undefined,
  settings: CameraSettings = DEFAULT_ZOOM_SETTINGS.camera,
  toSource?: ((timelineMs: number) => number) | undefined,
): Point {
  if (region.focus.mode !== "follow" || !cursor) return focusAt(region, tMs);
  const p = cameraFollowPath(region, cursor, settings, toSource).positionAt(tMs);
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

// ── Motion effects (§6.5 tilt, §9.8 parallax) ────────────────────────────────

/** Largest skew (radians) the tilt effect applies. */
export const TILT_MAX_RAD = 0.06;
/** Skew (radians) per normalized content unit / s of pivot velocity. */
export const TILT_GAIN = 0.05;
/** Half-width of the central difference used for camera velocity. */
export const TILT_DT_MS = 2 * FOLLOW_SAMPLE_MS;

/**
 * Tilt from camera velocity: `vx`/`vy` are pivot velocities in normalized
 * content units per second. Horizontal motion leans the frame (skew.x),
 * vertical motion shears it (skew.y); both fade in with zoom above 1×.
 */
export function cameraTilt(vx: number, vy: number, level: number): Point {
  const w = clamp(finiteOr(level, 1) - 1, 0, 1);
  const k = TILT_GAIN * w;
  // `+ 0` folds -0 into 0 so a still camera reports exactly no tilt.
  return {
    x: clamp(-finiteOr(vx, 0) * k, -TILT_MAX_RAD, TILT_MAX_RAD) + 0,
    y: clamp(finiteOr(vy, 0) * k, -TILT_MAX_RAD, TILT_MAX_RAD) + 0,
  };
}

/** Background offset as a fraction of the pivot's distance from center. */
export const PARALLAX_FACTOR = 0.08;
/** Background overscan so the offset never reveals an edge (max offset is 4% per side). */
export const PARALLAX_OVERSCAN = 1.08;

/** Parallax background offset (px) opposite the pivot delta from the content center. */
export function parallaxOffset(cam: CameraTransform): Point {
  return {
    x: -(finiteOr(cam.pivotX - cam.positionX, 0) * PARALLAX_FACTOR) || 0,
    y: -(finiteOr(cam.pivotY - cam.positionY, 0) * PARALLAX_FACTOR) || 0,
  };
}

export interface CameraInput {
  level: number;
  /** Normalized 0..1 content coords. */
  focus: Point;
  contentW: number;
  contentH: number;
}

/** CameraContainer transform, in content-local pixels. */
export interface CameraTransform {
  scale: number;
  pivotX: number;
  pivotY: number;
  positionX: number;
  positionY: number;
}

/**
 * `scale = z`, `pivot = f * contentSize`, `position = contentCenter` (§6.5).
 * The pivot is clamped so the visible rect (contentW/scale × contentH/scale)
 * stays inside the content bounds; at level 1 this is the identity
 * (pivot = position = center).
 */
export function cameraTransform({
  level,
  focus,
  contentW,
  contentH,
}: CameraInput): CameraTransform {
  const w = Math.max(0, finiteOr(contentW, 0));
  const h = Math.max(0, finiteOr(contentH, 0));
  const scale = Math.max(1, finiteOr(level, 1));
  const halfW = w / (2 * scale);
  const halfH = h / (2 * scale);
  const fx = clamp(finiteOr(focus.x, 0.5), 0, 1) * w;
  const fy = clamp(finiteOr(focus.y, 0.5), 0, 1) * h;
  return {
    scale,
    pivotX: clamp(fx, halfW, w - halfW),
    pivotY: clamp(fy, halfH, h - halfH),
    positionX: w / 2,
    positionY: h / 2,
  };
}

/** Webcam bubble zoom-reactive scale: `1 / (1 + (z-1)*0.5)` (§6.5). */
export function webcamZoomReactiveScale(level: number): number {
  const z = Math.max(1, finiteOr(level, 1));
  return 1 / (1 + (z - 1) * 0.5);
}
