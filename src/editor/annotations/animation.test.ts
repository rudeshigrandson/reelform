import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AnimType, AnnotationAnim, SlideDirection } from "../inspector/annotations/types";
import {
  type AnnotationTiming,
  POP_FROM_SCALE,
  SLIDE_DISTANCE,
  animDurations,
  annotationVisualAt,
  easeOutBack,
  easeOutCubic,
} from "./index";

const anim = (type: AnimType, ms = 200, direction: SlideDirection = "up"): AnnotationAnim => ({
  type,
  ms,
  direction,
});

const timing = (patch: Partial<AnnotationTiming> = {}): AnnotationTiming => ({
  startMs: 1000,
  endMs: 3000,
  animIn: anim("fade"),
  animOut: anim("fade"),
  ...patch,
});

describe("easing", () => {
  it("hits exact endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBe(1);
  });
  it("clamps out-of-range progress", () => {
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(7)).toBe(1);
  });
});

describe("annotationVisualAt", () => {
  it("is hidden outside the half-open range", () => {
    const a = timing();
    expect(annotationVisualAt(a, 999.999).visible).toBe(false);
    expect(annotationVisualAt(a, 1000).visible).toBe(true);
    expect(annotationVisualAt(a, 2999.999).visible).toBe(true);
    expect(annotationVisualAt(a, 3000).visible).toBe(false);
    expect(annotationVisualAt(a, Number.NaN).visible).toBe(false);
  });

  it("is hidden for empty / inverted ranges", () => {
    expect(annotationVisualAt(timing({ startMs: 2000, endMs: 2000 }), 2000).visible).toBe(false);
    expect(annotationVisualAt(timing({ startMs: 3000, endMs: 2000 }), 2500).visible).toBe(false);
  });

  it("fade: 0 at start, 1 while holding, approaches 0 at end", () => {
    const a = timing();
    expect(annotationVisualAt(a, 1000).opacity).toBe(0);
    expect(annotationVisualAt(a, 1100).opacity).toBeCloseTo(easeOutCubic(0.5), 12);
    expect(annotationVisualAt(a, 1200).opacity).toBe(1);
    expect(annotationVisualAt(a, 2000).opacity).toBe(1);
    expect(annotationVisualAt(a, 2800).opacity).toBe(1);
    expect(annotationVisualAt(a, 2999).opacity).toBeLessThan(0.02);
  });

  it("none: fully visible for the whole range", () => {
    const a = timing({ animIn: anim("none"), animOut: anim("none") });
    for (const t of [1000, 1500, 2999]) {
      expect(annotationVisualAt(a, t)).toEqual({
        visible: true,
        opacity: 1,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      });
    }
  });

  it("pop: grows from POP_FROM_SCALE and settles at 1", () => {
    const a = timing({ animIn: anim("pop"), animOut: anim("none") });
    const s0 = annotationVisualAt(a, 1000);
    expect(s0.scale).toBeCloseTo(POP_FROM_SCALE, 12);
    expect(s0.opacity).toBe(0);
    expect(annotationVisualAt(a, 1200).scale).toBe(1);
    // Overshoots slightly on the way in.
    const peak = Math.max(...[1120, 1140, 1160, 1180].map((t) => annotationVisualAt(a, t).scale));
    expect(peak).toBeGreaterThan(1);
  });

  it("slide in comes from the named edge; slide out leaves toward it", () => {
    const left = timing({ animIn: anim("slide", 200, "left"), animOut: anim("none") });
    expect(annotationVisualAt(left, 1000).offsetX).toBeCloseTo(-SLIDE_DISTANCE, 12);
    expect(annotationVisualAt(left, 1000).offsetY).toBe(0);
    expect(annotationVisualAt(left, 1200).offsetX).toBe(0);

    const down = timing({ animIn: anim("none"), animOut: anim("slide", 200, "down") });
    expect(annotationVisualAt(down, 2000).offsetY).toBe(0);
    expect(annotationVisualAt(down, 2999).offsetY).toBeGreaterThan(SLIDE_DISTANCE * 0.95);
  });

  it("scales anim durations down proportionally on short items", () => {
    expect(
      animDurations(
        timing({ startMs: 0, endMs: 100, animIn: anim("fade", 300), animOut: anim("fade", 100) }),
      ),
    ).toEqual({
      inMs: 75,
      outMs: 25,
    });
    expect(
      animDurations(timing({ animIn: anim("none", 500), animOut: anim("fade", Number.NaN) })),
    ).toEqual({
      inMs: 0,
      outMs: 0,
    });
  });

  it("property: opacity in [0,1], visible iff t in range, deterministic", () => {
    const animArb = fc.record({
      type: fc.constantFrom<AnimType>("none", "fade", "pop", "slide"),
      direction: fc.constantFrom<SlideDirection>("left", "right", "up", "down"),
      ms: fc.double({ min: -100, max: 5000, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        animArb,
        animArb,
        fc.double({ min: -2e5, max: 2e5, noNaN: true }),
        (startMs, len, animIn, animOut, t) => {
          const a = { startMs, endMs: startMs + len, animIn, animOut };
          const v = annotationVisualAt(a, t);
          expect(v.opacity).toBeGreaterThanOrEqual(0);
          expect(v.opacity).toBeLessThanOrEqual(1);
          expect(v.visible).toBe(len > 0 && t >= startMs && t < startMs + len);
          if (!v.visible) expect(v.opacity).toBe(0);
          expect(Number.isFinite(v.scale) && v.scale > 0).toBe(true);
          expect(Math.abs(v.offsetX)).toBeLessThanOrEqual(2 * SLIDE_DISTANCE + 1e-12);
          expect(annotationVisualAt(a, t)).toEqual(v);
        },
      ),
    );
  });
});
