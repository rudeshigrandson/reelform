import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../inspector/zoom/types";
import {
  activeRegionAt,
  cameraTransform,
  focusAt,
  webcamZoomReactiveScale,
  zoomLevelAt,
} from "./camera";

const region = (patch: Partial<ZoomRegion> = {}): ZoomRegion => ({
  id: "z1",
  startMs: 1000,
  endMs: 4000,
  level: 2,
  focus: { mode: "fixed", x: 0.25, y: 0.75 },
  easeInMs: 500,
  easeOutMs: 500,
  curve: "ease-out-cubic",
  source: "manual",
  ...patch,
});

const cursorAt = (x: number, y: number) => ({ positionAt: () => ({ x, y }) });

describe("zoomLevelAt", () => {
  it("is 1 at start, level mid-hold, 1 at end", () => {
    const r = [region()];
    expect(zoomLevelAt(r, 1000).level).toBe(1);
    expect(zoomLevelAt(r, 2500).level).toBe(2);
    expect(zoomLevelAt(r, 4000).level).toBeCloseTo(1, 10);
    expect(zoomLevelAt(r, 2500).region?.id).toBe("z1");
  });

  it("is 1 with no region outside all regions", () => {
    const r = [region()];
    for (const t of [0, 999, 4001, 1e9, Number.NaN]) {
      expect(zoomLevelAt(r, t)).toEqual({ level: 1, region: null });
    }
    expect(zoomLevelAt([], 2000).level).toBe(1);
  });

  it("eases monotonically in for linear", () => {
    const r = [region({ curve: "linear" })];
    expect(zoomLevelAt(r, 1250).level).toBeCloseTo(1.5, 10);
    expect(zoomLevelAt(r, 3750).level).toBeCloseTo(1.5, 10);
  });

  it("scales easeIn/easeOut proportionally when they exceed the region", () => {
    // 1000ms region with 1500+500 ease → scaled to 750+250.
    const r = [
      region({ startMs: 0, endMs: 1000, easeInMs: 1500, easeOutMs: 500, curve: "linear" }),
    ];
    expect(zoomLevelAt(r, 375).level).toBeCloseTo(1.5, 10);
    expect(zoomLevelAt(r, 750).level).toBeCloseTo(2, 10);
    expect(zoomLevelAt(r, 875).level).toBeCloseTo(1.5, 10);
    expect(zoomLevelAt(r, 1000).level).toBeCloseTo(1, 10);
  });

  it("jumps straight to level with zero easing", () => {
    const r = [region({ easeInMs: 0, easeOutMs: 0 })];
    expect(zoomLevelAt(r, 1000).level).toBe(2);
    expect(zoomLevelAt(r, 4000).level).toBe(2);
  });

  it("spring may overshoot but stays finite and >= 1", () => {
    const r = [region({ curve: "spring", level: 3 })];
    let max = 0;
    for (let t = 900; t <= 4100; t += 5) {
      const { level } = zoomLevelAt(r, t);
      expect(Number.isFinite(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(1);
      max = Math.max(max, level);
    }
    expect(max).toBeGreaterThan(3);
    expect(max).toBeLessThan(10);
  });

  it("picks the latest-starting region on overlap", () => {
    const a = region({ id: "a", startMs: 0, endMs: 5000 });
    const b = region({ id: "b", startMs: 2000, endMs: 3000 });
    expect(activeRegionAt([b, a], 2500)?.id).toBe("b");
    expect(activeRegionAt([a, b], 4000)?.id).toBe("a");
  });

  it("ignores degenerate regions", () => {
    expect(zoomLevelAt([region({ startMs: 2000, endMs: 2000 })], 2000).level).toBe(1);
  });
});

describe("focusAt", () => {
  it("fixed uses region focus even with a cursor", () => {
    expect(focusAt(region(), 2000, cursorAt(0.9, 0.1))).toEqual({ x: 0.25, y: 0.75 });
  });

  it("follow uses the cursor, clamped", () => {
    const r = region({ focus: { mode: "follow", x: 0.5, y: 0.5 } });
    expect(focusAt(r, 2000, cursorAt(0.9, 0.1))).toEqual({ x: 0.9, y: 0.1 });
    expect(focusAt(r, 2000, cursorAt(1.4, -2))).toEqual({ x: 1, y: 0 });
  });

  it("follow falls back to region focus without a cursor", () => {
    const r = region({ focus: { mode: "follow", x: 0.3, y: 0.6 } });
    expect(focusAt(r, 2000)).toEqual({ x: 0.3, y: 0.6 });
    expect(focusAt(r, 2000, null)).toEqual({ x: 0.3, y: 0.6 });
  });
});

describe("cameraTransform", () => {
  it("is identity at level 1 for any focus", () => {
    expect(
      cameraTransform({ level: 1, focus: { x: 0, y: 1 }, contentW: 800, contentH: 450 }),
    ).toEqual({
      scale: 1,
      pivotX: 400,
      pivotY: 225,
      positionX: 400,
      positionY: 225,
    });
  });

  it("centers on focus when not near edges", () => {
    const c = cameraTransform({
      level: 2,
      focus: { x: 0.5, y: 0.5 },
      contentW: 800,
      contentH: 400,
    });
    expect(c).toMatchObject({ scale: 2, pivotX: 400, pivotY: 200 });
  });

  it("clamps focus at a corner", () => {
    const c = cameraTransform({ level: 2, focus: { x: 0, y: 1 }, contentW: 800, contentH: 400 });
    expect(c.pivotX).toBe(200);
    expect(c.pivotY).toBe(300);
  });

  it("handles zero content and junk input without NaN", () => {
    const c = cameraTransform({
      level: Number.NaN,
      focus: { x: Number.NaN, y: 2 },
      contentW: 0,
      contentH: -5,
    });
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
    expect(c.scale).toBe(1);
  });

  it("property: visible rect always stays inside content", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 4000, noNaN: true }),
        fc.double({ min: 1, max: 4000, noNaN: true }),
        (level, fx, fy, w, h) => {
          const c = cameraTransform({ level, focus: { x: fx, y: fy }, contentW: w, contentH: h });
          const eps = 1e-6 * Math.max(w, h);
          // Screen point p maps to content (p - position)/scale + pivot.
          const left = (0 - c.positionX) / c.scale + c.pivotX;
          const right = (w - c.positionX) / c.scale + c.pivotX;
          const top = (0 - c.positionY) / c.scale + c.pivotY;
          const bottom = (h - c.positionY) / c.scale + c.pivotY;
          expect(left).toBeGreaterThanOrEqual(-eps);
          expect(top).toBeGreaterThanOrEqual(-eps);
          expect(right).toBeLessThanOrEqual(w + eps);
          expect(bottom).toBeLessThanOrEqual(h + eps);
        },
      ),
    );
  });
});

describe("webcamZoomReactiveScale", () => {
  it("follows 1 / (1 + (z-1)*0.5)", () => {
    expect(webcamZoomReactiveScale(1)).toBe(1);
    expect(webcamZoomReactiveScale(2)).toBeCloseTo(2 / 3, 10);
    expect(webcamZoomReactiveScale(3)).toBeCloseTo(0.5, 10);
    expect(webcamZoomReactiveScale(Number.NaN)).toBe(1);
  });
});
