import type {
  AnimType,
  Annotation,
  AnnotationAnim,
  SlideDirection,
} from "../inspector/annotations/types";

/**
 * Annotation in/out animation (ENGINEERING_SPEC §6.4 / §9.7). Every value is
 * a pure function of the annotation timing and `tMs` — no frame deltas, no
 * clocks — so preview and export agree.
 *
 * Visible range is half-open `[startMs, endMs)`. The in animation runs over
 * the first `animIn.ms`, the out animation over the last `animOut.ms`; when
 * both exceed the item length they are scaled down proportionally.
 */

/** Slide travel as a fraction of the containing layer's width/height. */
export const SLIDE_DISTANCE = 0.05;
/** Pop starts (and ends) at this scale. */
export const POP_FROM_SCALE = 0.6;

export interface AnnotationVisual {
  visible: boolean;
  /** Animation opacity 0..1 (multiply by the annotation's own `opacity`). */
  opacity: number;
  scale: number;
  /** Normalized offsets: fractions of the containing layer's width / height. */
  offsetX: number;
  offsetY: number;
}

export const HIDDEN_VISUAL: Readonly<AnnotationVisual> = {
  visible: false,
  opacity: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export type AnnotationTiming = Pick<Annotation, "startMs" | "endMs" | "animIn" | "animOut">;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const nonNegMs = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function easeOutCubic(p: number): number {
  const q = 1 - clamp01(p);
  return 1 - q * q * q;
}

/** Back ease-out: 0 → 1 with a small (~10%) overshoot. */
export function easeOutBack(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const q = clamp01(p) - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

const DIRECTIONS: Readonly<Record<SlideDirection, { x: number; y: number }>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export interface AnimEffect {
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Effect of one animation at progress `p` (0 = fully hidden, 1 = settled).
 * For `slide` the direction is the edge the item comes from (in) / goes to (out).
 */
export function animEffect(type: AnimType, direction: SlideDirection, p: number): AnimEffect {
  const e = easeOutCubic(p);
  switch (type) {
    case "fade":
      return { opacity: e, scale: 1, offsetX: 0, offsetY: 0 };
    case "pop":
      return {
        opacity: clamp01(clamp01(p) * 2),
        scale: POP_FROM_SCALE + (1 - POP_FROM_SCALE) * easeOutBack(p),
        offsetX: 0,
        offsetY: 0,
      };
    case "slide": {
      const d = DIRECTIONS[direction] ?? DIRECTIONS.up;
      const k = (1 - e) * SLIDE_DISTANCE;
      return { opacity: e, scale: 1, offsetX: d.x * k, offsetY: d.y * k };
    }
    default:
      return { opacity: 1, scale: 1, offsetX: 0, offsetY: 0 };
  }
}

/** Effective in/out durations after proportional scaling to the item length. */
export function animDurations(a: AnnotationTiming): { inMs: number; outMs: number } {
  const length = Math.max(0, a.endMs - a.startMs);
  const animMs = (anim: AnnotationAnim): number => (anim.type === "none" ? 0 : nonNegMs(anim.ms));
  let inMs = animMs(a.animIn);
  let outMs = animMs(a.animOut);
  if (inMs + outMs > length) {
    const k = inMs + outMs > 0 ? length / (inMs + outMs) : 0;
    inMs *= k;
    outMs *= k;
  }
  return { inMs, outMs };
}

export function annotationVisualAt(a: AnnotationTiming, tMs: number): AnnotationVisual {
  if (
    !Number.isFinite(tMs) ||
    !Number.isFinite(a.startMs) ||
    !Number.isFinite(a.endMs) ||
    !(a.endMs > a.startMs) ||
    tMs < a.startMs ||
    tMs >= a.endMs
  ) {
    return { ...HIDDEN_VISUAL };
  }
  const { inMs, outMs } = animDurations(a);
  const pIn = inMs > 0 ? clamp01((tMs - a.startMs) / inMs) : 1;
  const pOut = outMs > 0 ? clamp01((a.endMs - tMs) / outMs) : 1;
  const fin = animEffect(a.animIn.type, a.animIn.direction, pIn);
  const fout = animEffect(a.animOut.type, a.animOut.direction, pOut);
  return {
    visible: true,
    opacity: clamp01(fin.opacity * fout.opacity),
    scale: fin.scale * fout.scale,
    offsetX: fin.offsetX + fout.offsetX,
    offsetY: fin.offsetY + fout.offsetY,
  };
}
