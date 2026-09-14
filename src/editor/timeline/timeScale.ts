/**
 * Time ↔ pixel mapping for the timeline (ENGINEERING_SPEC §6.7).
 * `pxPerMs` is the zoom; `scrollMs` is the timeline time at the viewport's left edge.
 */

export interface TimeScale {
  readonly pxPerMs: number;
  readonly scrollMs: number;
}

/** Narrowest visible span when fully zoomed in (§6.7: "zoom range 5s…full"). */
export const MIN_VISIBLE_MS = 5000;

/** Frame ticks appear at ≥ 200 px per second (§6.7). */
export const FRAME_TICKS_MIN_PX_PER_MS = 0.2;

/** Minimum px between labelled (major) ruler ticks. */
export const MAJOR_TICK_MIN_PX = 64;

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export function msToPx(ms: number, scale: TimeScale): number {
  return (ms - scale.scrollMs) * scale.pxPerMs;
}

export function pxToMs(px: number, scale: TimeScale): number {
  return scale.pxPerMs > 0 ? px / scale.pxPerMs + scale.scrollMs : scale.scrollMs;
}

/** Visible-span limits: [min(5s, full), full]. Zero duration falls back to 5s. */
export function spanLimits(durationMs: number): { minMs: number; maxMs: number } {
  const maxMs = durationMs > 0 && Number.isFinite(durationMs) ? durationMs : MIN_VISIBLE_MS;
  return { minMs: Math.min(MIN_VISIBLE_MS, maxMs), maxMs };
}

/** Scale that shows the whole duration in the viewport. */
export function fitScale(durationMs: number, viewportPx: number): TimeScale {
  const px = Math.max(0, finiteOr(viewportPx, 0));
  return { pxPerMs: px / spanLimits(durationMs).maxMs, scrollMs: 0 };
}

/** Clamp zoom so the visible span stays within 5s…full, and scroll within [0, duration − span]. */
export function clampScale(scale: TimeScale, durationMs: number, viewportPx: number): TimeScale {
  const px = Math.max(0, finiteOr(viewportPx, 0));
  if (px === 0) return { pxPerMs: 0, scrollMs: 0 };
  const { minMs, maxMs } = spanLimits(durationMs);
  const pxPerMs = clamp(finiteOr(scale.pxPerMs, px / maxMs), px / maxMs, px / minMs);
  const visibleMs = px / pxPerMs;
  const maxScroll = Math.max(0, Math.max(0, finiteOr(durationMs, 0)) - visibleMs);
  return { pxPerMs, scrollMs: clamp(finiteOr(scale.scrollMs, 0), 0, maxScroll) };
}

/** Zoom by `factor` keeping the time under `anchorPx` fixed. Unclamped; pass through `clampScale`. */
export function zoomAround(scale: TimeScale, anchorPx: number, factor: number): TimeScale {
  const f = factor > 0 && Number.isFinite(factor) ? factor : 1;
  const anchorMs = pxToMs(anchorPx, scale);
  const pxPerMs = scale.pxPerMs * f;
  if (!(pxPerMs > 0)) return scale;
  return { pxPerMs, scrollMs: anchorMs - anchorPx / pxPerMs };
}

export interface RulerTick {
  readonly ms: number;
  /** Viewport x in px. */
  readonly px: number;
  readonly major: boolean;
  /** Only major ticks carry a label. */
  readonly label: string | null;
}

/** [major step ms, minor subdivisions]. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [100, 5],
  [200, 4],
  [500, 5],
  [1000, 5],
  [2000, 4],
  [5000, 5],
  [10000, 5],
  [15000, 3],
  [30000, 6],
  [60000, 6],
  [120000, 4],
  [300000, 5],
  [600000, 5],
  [1800000, 6],
  [3600000, 6],
];

const MAX_TICKS = 4000;

/** Pick the smallest nice major step that leaves ≥ MAJOR_TICK_MIN_PX between labels. */
export function majorStep(pxPerMs: number): readonly [number, number] {
  for (const step of STEPS) {
    if (step[0] * pxPerMs >= MAJOR_TICK_MIN_PX) return step;
  }
  return STEPS[STEPS.length - 1] ?? [3600000, 6];
}

/** Ruler label for a tick at `ms`, precise enough for `stepMs` (unique across ticks). */
export function formatTickLabel(ms: number, stepMs: number): string {
  const decimals = stepMs % 1000 === 0 ? 0 : stepMs % 100 === 0 ? 1 : 2;
  const totalS = Math.max(0, ms) / 1000;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor(totalS / 60) % 60;
  const sec = totalS - Math.floor(totalS / 60) * 60;
  const unit = 10 ** decimals;
  // Round on integer units to avoid 1.9999 → "1.99".
  const units = Math.round(sec * unit);
  const whole = Math.floor(units / unit);
  const frac = units % unit;
  const secText =
    decimals > 0
      ? `${String(whole).padStart(2, "0")}.${String(frac).padStart(decimals, "0")}`
      : String(whole).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${secText}` : `${m}:${secText}`;
}

/**
 * Ruler ticks across the viewport. Majors are labelled at a nice step; minors
 * subdivide it, switching to one tick per frame at ≥ 200 px/s.
 */
export function rulerTicks(scale: TimeScale, viewportPx: number, fps: number): RulerTick[] {
  if (!(scale.pxPerMs > 0) || !(viewportPx > 0) || !Number.isFinite(scale.scrollMs)) return [];
  const startMs = Math.max(0, scale.scrollMs);
  const endMs = scale.scrollMs + viewportPx / scale.pxPerMs;
  if (endMs < startMs) return [];
  const [step, divisions] = majorStep(scale.pxPerMs);
  const ticks: RulerTick[] = [];
  const push = (ms: number, major: boolean): void => {
    ticks.push({
      ms,
      px: msToPx(ms, scale),
      major,
      label: major ? formatTickLabel(ms, step) : null,
    });
  };

  const firstMajor = Math.ceil(startMs / step);
  const lastMajor = Math.floor(endMs / step);
  for (let i = firstMajor; i <= lastMajor && ticks.length < MAX_TICKS; i++) push(i * step, true);

  const frameMode = scale.pxPerMs >= FRAME_TICKS_MIN_PX_PER_MS && fps > 0 && Number.isFinite(fps);
  const minorMs = frameMode ? 1000 / fps : step / divisions;
  const first = Math.ceil(startMs / minorMs);
  const last = Math.floor(endMs / minorMs);
  for (let k = first; k <= last && ticks.length < MAX_TICKS; k++) {
    const ms = k * minorMs;
    const nearest = Math.round(ms / step) * step;
    if (Math.abs(ms - nearest) < 0.5) continue; // coincides with a major tick
    push(ms, false);
  }
  ticks.sort((a, b) => a.ms - b.ms);
  return ticks;
}

/** "mm:ss.mmm" (with "h:" prefix past an hour) — used in item accessible names. */
export function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const milli = safe % 1000;
  const totalS = Math.floor(safe / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const core = `${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
  return h > 0 ? `${h}:${core}` : core;
}
