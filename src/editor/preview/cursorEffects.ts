import type { TelemetryClick } from "../autozoom/types";
import type { ClickEffect } from "../inspector/cursor/types";

/**
 * Cursor effects (ENGINEERING_SPEC §6.6): click ripple / bounce / highlight,
 * motion-blur ghosts, idle sway, hide-when-idle and loop blending. Every
 * function is pure in time — telemetry is indexed once (`buildCursorMotion`)
 * and each query is a function of `tMs` only, so export frames match preview.
 * Times here are SOURCE ms (telemetry time), not timeline ms.
 */

export const RIPPLE_MS = 300;
export const BOUNCE_MS = 180;
export const BOUNCE_MIN_SCALE = 0.85;
export const HIGHLIGHT_FADE_IN_MS = 80;
export const HIGHLIGHT_FADE_OUT_MS = 150;
/** Ghost trail window at amount 50 (§6.6: last 40ms). */
export const GHOST_WINDOW_MS = 40;
export const MAX_GHOSTS = 6;
export const SWAY_IDLE_MS = 600;
export const SWAY_RAMP_MS = 300;
export const SWAY_MAX_PX = 3;
export const HIDE_FADE_OUT_MS = 250;
export const HIDE_FADE_IN_MS = 150;
export const LOOP_MS = 500;
/** Shortest stillness indexed (the hide-idle delay minimum). */
export const IDLE_MIN_MS = 500;
/** Normalized movement below which the cursor counts as still. */
export const IDLE_EPSILON = 0.0015;
/** Click effect base radius in reference px at 100%. */
export const CLICK_EFFECT_BASE_PX = 22;

export interface MotionPoint {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
  readonly cursorType?: string | undefined;
}

export interface ClickEvent {
  tMs: number;
  x: number;
  y: number;
  button: string;
  /** Matching release, or null when the recording ended while held. */
  upMs: number | null;
}

export interface IdleInterval {
  startMs: number;
  /** Infinity when the cursor stays still until the end. */
  endMs: number;
}

export interface CursorMotion {
  clicks: readonly ClickEvent[];
  idle: readonly IdleInterval[];
  /** Cursor type of the latest raw sample at or before `tMs`. */
  typeAt(tMs: number): string | undefined;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const easeOutCubic = (p: number): number => 1 - (1 - clamp01(p)) ** 3;

/** Pair each `down` with the next `up` of the same button. Sorted by time. */
export function pairClicks(clicks: readonly TelemetryClick[]): ClickEvent[] {
  const sorted = [...clicks]
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2]))
    .sort((a, b) => a[0] - b[0]);
  const out: ClickEvent[] = [];
  const open = new Map<string, ClickEvent>();
  for (const [tMs, x, y, button, phase] of sorted) {
    if (phase === "down") {
      const ev: ClickEvent = { tMs, x, y, button, upMs: null };
      out.push(ev);
      open.set(button, ev);
    } else {
      const ev = open.get(button);
      if (ev) {
        ev.upMs = tMs;
        open.delete(button);
      }
    }
  }
  return out;
}

/** Stretches where the cursor stays within `eps` of where it stopped for ≥ `minMs`. */
export function idleIntervals(
  points: readonly MotionPoint[],
  minMs = IDLE_MIN_MS,
  eps = IDLE_EPSILON,
): IdleInterval[] {
  const pts = points.filter(
    (p) => Number.isFinite(p.tMs) && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const out: IdleInterval[] = [];
  const first = pts[0];
  if (!first) return out;
  let anchor = first;
  let lastStill = first.tMs;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as MotionPoint;
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) > eps) {
      if (lastStill - anchor.tMs >= minMs) out.push({ startMs: anchor.tMs, endMs: lastStill });
      anchor = p;
    }
    lastStill = p.tMs;
  }
  // Still at the end of the recording: idle forever after.
  if (lastStill - anchor.tMs >= 0)
    out.push({ startMs: anchor.tMs, endMs: Number.POSITIVE_INFINITY });
  return out.filter((iv) => iv.endMs - iv.startMs >= minMs);
}

export function buildCursorMotion(input: {
  points: readonly MotionPoint[];
  clicks?: readonly TelemetryClick[] | undefined;
}): CursorMotion {
  const pts = [...input.points].filter((p) => Number.isFinite(p.tMs)).sort((a, b) => a.tMs - b.tMs);
  return {
    clicks: pairClicks(input.clicks ?? []),
    idle: idleIntervals(pts),
    typeAt(tMs) {
      let lo = 0;
      let hi = pts.length - 1;
      let found: MotionPoint | undefined;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const p = pts[mid] as MotionPoint;
        if (p.tMs <= tMs) {
          found = p;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return (found ?? pts[0])?.cursorType;
    },
  };
}

/** Bounce: scale 1 → 0.85 → 1 over 180ms from each down. */
export function bounceScale(clicks: readonly ClickEvent[], tMs: number): number {
  let s = 1;
  for (const c of clicks) {
    const p = (tMs - c.tMs) / BOUNCE_MS;
    if (p < 0 || p > 1) continue;
    s = Math.min(s, 1 - (1 - BOUNCE_MIN_SCALE) * Math.sin(Math.PI * p));
  }
  return s;
}

export interface ClickFx {
  kind: "ripple" | "highlight";
  /** Normalized source coords. */
  x: number;
  y: number;
  /** 0..1 through the effect. */
  progress: number;
  alpha: number;
  /** Multiplier on the effect base radius. */
  radius: number;
}

/** Active ring effects at `tMs` for the chosen click effect. */
export function clickEffectsAt(
  type: ClickEffect,
  clicks: readonly ClickEvent[],
  tMs: number,
): ClickFx[] {
  const out: ClickFx[] = [];
  if (type !== "ripple" && type !== "highlight") return out;
  for (const c of clicks) {
    if (tMs < c.tMs) break;
    if (type === "ripple") {
      const p = (tMs - c.tMs) / RIPPLE_MS;
      if (p > 1) continue;
      out.push({
        kind: "ripple",
        x: c.x,
        y: c.y,
        progress: p,
        alpha: 1 - p,
        radius: 0.25 + 0.75 * easeOutCubic(p),
      });
    } else {
      // Held for at least the fade-in; a missing release holds for one fade-in.
      const up = Math.max(c.upMs ?? c.tMs + HIGHLIGHT_FADE_IN_MS, c.tMs + HIGHLIGHT_FADE_IN_MS);
      const end = up + HIGHLIGHT_FADE_OUT_MS;
      if (tMs > end) continue;
      const fadeIn = clamp01((tMs - c.tMs) / HIGHLIGHT_FADE_IN_MS);
      const fadeOut = tMs <= up ? 1 : 1 - clamp01((tMs - up) / HIGHLIGHT_FADE_OUT_MS);
      const alpha = Math.min(fadeIn, fadeOut);
      out.push({
        kind: "highlight",
        x: c.x,
        y: c.y,
        progress: clamp01((tMs - c.tMs) / (end - c.tMs)),
        alpha,
        radius: 1,
      });
    }
  }
  return out;
}

/**
 * Ghost sample offsets (ms back in time) and alphas for motion blur. Amount
 * 0..100 maps to count (1..6) and spread (20..60ms around the 40ms window).
 */
export function motionBlurGhosts(amount: number): Array<{ backMs: number; alpha: number }> {
  const a = clamp01((Number.isFinite(amount) ? amount : 0) / 100);
  if (a <= 0) return [];
  const count = Math.max(1, Math.round(MAX_GHOSTS * a));
  const spread = GHOST_WINDOW_MS * (0.5 + a);
  const out: Array<{ backMs: number; alpha: number }> = [];
  for (let i = 1; i <= count; i++) {
    out.push({ backMs: (spread * i) / count, alpha: 0.35 * (1 - i / (count + 1)) });
  }
  return out;
}

export interface IdleSample {
  /** How long the cursor has been still at `tMs` (0 when moving). */
  idleForMs: number;
  /** Time since the most recent idle stretch ended, or null. */
  sinceIdleEndMs: number | null;
  /** Length of that most recent ended stretch. */
  endedIdleLengthMs: number;
}

export function idleAt(idle: readonly IdleInterval[], tMs: number): IdleSample {
  let lo = 0;
  let hi = idle.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((idle[mid] as IdleInterval).startMs <= tMs) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const iv = idx >= 0 ? (idle[idx] as IdleInterval) : null;
  if (!iv) return { idleForMs: 0, sinceIdleEndMs: null, endedIdleLengthMs: 0 };
  if (tMs < iv.endMs)
    return { idleForMs: tMs - iv.startMs, sinceIdleEndMs: null, endedIdleLengthMs: 0 };
  return { idleForMs: 0, sinceIdleEndMs: tMs - iv.endMs, endedIdleLengthMs: iv.endMs - iv.startMs };
}

/** Hide-when-idle alpha: fade out after `delayMs` still, fade back in on move. */
export function hideIdleAlpha(idle: readonly IdleInterval[], tMs: number, delayMs: number): number {
  const d = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
  const s = idleAt(idle, tMs);
  if (s.idleForMs > 0) return 1 - clamp01((s.idleForMs - d) / HIDE_FADE_OUT_MS);
  if (s.sinceIdleEndMs !== null && s.endedIdleLengthMs > d) {
    // It had faded (partly) out; fade in from where it was.
    const from = 1 - clamp01((s.endedIdleLengthMs - d) / HIDE_FADE_OUT_MS);
    return from + (1 - from) * clamp01(s.sinceIdleEndMs / HIDE_FADE_IN_MS);
  }
  return 1;
}

/** Deterministic 1D value noise in [-1, 1]. */
export function valueNoise(t: number, seed: number): number {
  const hash = (i: number): number => {
    let h = Math.imul(i ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return ((h >>> 0) / 0xffffffff) * 2 - 1;
  };
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) + (hash(i + 1) - hash(i)) * u;
}

/** Idle sway offset in reference px (≤ 3px), ramping in after 600ms still. */
export function swayOffset(
  idle: readonly IdleInterval[],
  tMs: number,
  maxPx = SWAY_MAX_PX,
): { x: number; y: number } {
  const s = idleAt(idle, tMs);
  if (s.idleForMs <= SWAY_IDLE_MS) return { x: 0, y: 0 };
  const ramp = clamp01((s.idleForMs - SWAY_IDLE_MS) / SWAY_RAMP_MS);
  const t = tMs / 900;
  return { x: valueNoise(t, 17) * maxPx * ramp, y: valueNoise(t, 91) * maxPx * ramp };
}

/** Loop mode weight toward the t=0 position over the last 500ms (0..1, eased). */
export function loopBlend(tMs: number, durationMs: number): number {
  if (!(durationMs > 0) || !Number.isFinite(tMs)) return 0;
  const window = Math.min(LOOP_MS, durationMs);
  const p = clamp01((tMs - (durationMs - window)) / window);
  return p * p * (3 - 2 * p);
}
