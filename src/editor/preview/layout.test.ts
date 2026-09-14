import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASPECT_PRESETS,
  DEFAULT_FRAME_SETTINGS,
  type FrameSettings,
} from "../inspector/frame/types";
import { LAYOUT_REFERENCE_LONG_EDGE, type Rect, computeFrameLayout } from "./layout";

const base = (): FrameSettings => structuredClone(DEFAULT_FRAME_SETTINGS);
const SRC = { width: 2880, height: 1800 };
const EPS = 1e-6;

const inside = (inner: Rect, outer: Rect, eps = EPS) =>
  inner.x >= outer.x - eps &&
  inner.y >= outer.y - eps &&
  inner.x + inner.width <= outer.x + outer.width + eps &&
  inner.y + inner.height <= outer.y + outer.height + eps;

const allFinite = (o: unknown): boolean => {
  if (typeof o === "number") return Number.isFinite(o) && o >= -EPS;
  if (o && typeof o === "object") return Object.values(o).every(allFinite);
  return true;
};

describe("computeFrameLayout — aspect", () => {
  const expected: Record<(typeof ASPECT_PRESETS)[number], number> = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1": 1,
    "4:3": 4 / 3,
    "4:5": 4 / 5,
    "21:9": 21 / 9,
    source: SRC.width / SRC.height,
    custom: 1000 / 500,
  };

  for (const preset of ASPECT_PRESETS) {
    it(`${preset} yields a matching box that fits the canvas`, () => {
      const s = base();
      s.aspect = { preset, customWidth: 1000, customHeight: 500 };
      for (const canvas of [
        { width: 1280, height: 720 },
        { width: 400, height: 900 },
        { width: 1000, height: 1000 },
      ]) {
        const l = computeFrameLayout(canvas, s, SRC);
        expect(l.frame.width / l.frame.height).toBeCloseTo(expected[preset], 6);
        expect(inside(l.frame, { x: 0, y: 0, ...canvas })).toBe(true);
        // Letterboxed: touches at least one pair of canvas edges.
        const touches =
          Math.abs(l.frame.width - canvas.width) < EPS ||
          Math.abs(l.frame.height - canvas.height) < EPS;
        expect(touches).toBe(true);
      }
    });
  }

  it("source falls back to 16:9 when source size is unknown", () => {
    const s = base();
    s.aspect = { ...s.aspect, preset: "source" };
    const l = computeFrameLayout({ width: 1600, height: 1600 }, s, null);
    expect(l.aspectRatio).toBeCloseTo(16 / 9, 10);
  });
});

describe("computeFrameLayout — padding & content", () => {
  it("scales padding by frame long edge / 1920", () => {
    const s = base(); // 16:9, padding 64
    const l = computeFrameLayout({ width: 960, height: 540 }, s, SRC);
    expect(l.scale).toBeCloseTo(960 / LAYOUT_REFERENCE_LONG_EDGE, 10);
    expect(l.padding.left).toBeCloseTo(32, 10);
    const big = computeFrameLayout({ width: 1920, height: 1080 }, s, SRC);
    expect(big.padding.left).toBeCloseTo(64, 10);
    // Same relative look at both sizes.
    expect(l.content.width / l.frame.width).toBeCloseTo(big.content.width / big.frame.width, 10);
  });

  it("per-side padding is asymmetric", () => {
    const s = base();
    s.aspect = { ...s.aspect, preset: "16:9" };
    s.padding = { matchAll: false, all: 0, top: 0, right: 200, bottom: 0, left: 0 };
    s.inset = 100;
    const l = computeFrameLayout({ width: 1920, height: 1080 }, s, { width: 1000, height: 1000 });
    expect(l.padding).toEqual({ top: 0, right: 200, bottom: 0, left: 0 });
    expect(l.paddedArea).toEqual({ x: 0, y: 0, width: 1720, height: 1080 });
    // Square source centered in the padded area, shifted left of canvas center.
    expect(l.content.x + l.content.width / 2).toBeCloseTo(860, 10);
  });

  it("inset scales content around the padded-area center", () => {
    const s = base();
    s.inset = 50;
    const full = computeFrameLayout({ width: 1920, height: 1080 }, { ...s, inset: 100 }, SRC);
    const half = computeFrameLayout({ width: 1920, height: 1080 }, s, SRC);
    expect(half.content.width).toBeCloseTo(full.content.width / 2, 10);
    expect(half.content.x + half.content.width / 2).toBeCloseTo(
      full.content.x + full.content.width / 2,
      10,
    );
  });

  it("scales radius, border, shadow and caps radius at half the content", () => {
    const s = base();
    s.radius = 64;
    s.border.width = 4;
    s.shadow = { ...s.shadow, offsetY: 20, blur: 40 };
    const l = computeFrameLayout({ width: 960, height: 540 }, s, SRC);
    expect(l.radius).toBeCloseTo(32, 10);
    expect(l.borderWidth).toBeCloseTo(2, 10);
    expect(l.shadowOffsetY).toBeCloseTo(10, 10);
    expect(l.shadowBlur).toBeCloseTo(20, 10);
    const tiny = computeFrameLayout({ width: 40, height: 22 }, s, SRC);
    expect(tiny.radius).toBeLessThanOrEqual(
      Math.min(tiny.content.width, tiny.content.height) / 2 + EPS,
    );
  });

  it("uses the cropped source aspect", () => {
    const s = base();
    s.padding = { matchAll: true, all: 0, top: 0, right: 0, bottom: 0, left: 0 };
    s.crop = { x: 0, y: 0, width: 0.5, height: 1 };
    const l = computeFrameLayout({ width: 1920, height: 1080 }, s, { width: 1920, height: 1080 });
    expect(l.content.width / l.content.height).toBeCloseTo(8 / 9, 6);
  });

  it("zero / tiny canvas produces no NaN or negative sizes", () => {
    const s = base();
    s.padding = { matchAll: false, all: 200, top: 200, right: 200, bottom: 200, left: 200 };
    for (const canvas of [
      { width: 0, height: 0 },
      { width: 1, height: 1 },
      { width: 0, height: 500 },
      { width: -10, height: Number.NaN },
    ]) {
      const l = computeFrameLayout(canvas, s, { width: 0, height: 0 });
      expect(allFinite(l)).toBe(true);
      expect(inside(l.content, l.frame)).toBe(true);
    }
  });

  it("property: content rect always inside padded area and frame box", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 0, max: 4000 }),
        fc.constantFrom(...ASPECT_PRESETS),
        fc.boolean(),
        fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 5, maxLength: 5 }),
        fc.double({ min: 50, max: 100, noNaN: true }),
        fc.integer({ min: 64, max: 7680 }),
        fc.integer({ min: 64, max: 7680 }),
        (cw, ch, preset, matchAll, pads, inset, customW, customH) => {
          const [all = 0, top = 0, right = 0, bottom = 0, left = 0] = pads;
          const s = base();
          s.aspect = { preset, customWidth: customW, customHeight: customH };
          s.padding = { matchAll, all, top, right, bottom, left };
          s.inset = inset;
          const canvas = { width: cw, height: ch };
          const l = computeFrameLayout(canvas, s, { width: customH, height: customW });
          const tol = 1e-6 * Math.max(1, cw, ch);
          expect(allFinite(l)).toBe(true);
          expect(inside(l.frame, { x: 0, y: 0, ...canvas }, tol)).toBe(true);
          expect(inside(l.paddedArea, l.frame, tol)).toBe(true);
          expect(inside(l.content, l.paddedArea, tol)).toBe(true);
        },
      ),
    );
  });
});
