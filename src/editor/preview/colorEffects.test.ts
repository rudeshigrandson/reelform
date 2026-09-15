import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECTS_SETTINGS } from "../inspector/effects/types";
import {
  GRAIN_NOISE,
  IDENTITY_COLOR_MATRIX,
  VIGNETTE_MAX_ALPHA,
  applyColorMatrix,
  colorMatrix,
  evaluateColorFx,
  frameIndex,
  grainSeed,
} from "./colorEffects";

const color = DEFAULT_EFFECTS_SETTINGS.color;

describe("colorMatrix", () => {
  it("is identity at zero", () => {
    colorMatrix({ brightness: 0, contrast: 0, saturation: 0 }).forEach((v, i) => {
      expect(v).toBeCloseTo(IDENTITY_COLOR_MATRIX[i] ?? 0);
    });
  });

  it("brightness scales, contrast pivots on mid-gray, saturation -100 is gray", () => {
    const b = applyColorMatrix(
      colorMatrix({ brightness: 50, contrast: 0, saturation: 0 }),
      [0.4, 0.4, 0.4, 1],
    );
    expect(b[0]).toBeCloseTo(0.6);
    const c = colorMatrix({ brightness: 0, contrast: 100, saturation: 0 });
    expect(applyColorMatrix(c, [0.5, 0.5, 0.5, 1])[0]).toBeCloseTo(0.5);
    expect(applyColorMatrix(c, [0.75, 0.75, 0.75, 1])[0]).toBeCloseTo(1);
    const gray = applyColorMatrix(
      colorMatrix({ brightness: 0, contrast: 0, saturation: -100 }),
      [1, 0, 0, 1],
    );
    expect(gray[0]).toBeCloseTo(gray[1]);
    expect(gray[1]).toBeCloseTo(gray[2]);
    expect(gray[3]).toBeCloseTo(1);
  });

  it("clamps out-of-range and non-finite inputs", () => {
    expect(colorMatrix({ brightness: 500, contrast: Number.NaN, saturation: 0 })).toEqual(
      colorMatrix({ brightness: 100, contrast: 0, saturation: 0 }),
    );
  });
});

describe("grain + vignette", () => {
  it("seeds grain by frame index (deterministic, changes per frame)", () => {
    expect(frameIndex(1000 / 30, 30)).toBe(1);
    expect(grainSeed(10, 30)).toBe(grainSeed(20, 30));
    expect(grainSeed(0, 30)).not.toBe(grainSeed(34, 30));
    const s = grainSeed(123_456, 60);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(1);
  });

  it("evaluateColorFx: defaults are a no-op", () => {
    expect(evaluateColorFx(color, 0, 30)).toEqual({ matrix: null, vignette: 0, grain: null });
    const fx = evaluateColorFx({ ...color, grain: true, vignette: 100, saturation: 20 }, 500, 30);
    expect(fx.vignette).toBe(VIGNETTE_MAX_ALPHA);
    expect(fx.grain?.noise).toBe(GRAIN_NOISE);
    expect(fx.matrix).toHaveLength(20);
  });
});
