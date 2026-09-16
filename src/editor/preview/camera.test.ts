import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../inspector/zoom/types";
import {
  FOLLOW_SAMPLE_MS,
  FOLLOW_SILKY_CUTOFF_HZ,
  FOLLOW_SNAPPY_CUTOFF_HZ,
  FOLLOW_SPEED_PER_ZOOM_SPEED,
  PARALLAX_FACTOR,
  PARALLAX_OVERSCAN,
  TILT_GAIN,
  TILT_MAX_RAD,
  activeRegionAt,
  buildCameraFollowPath,
  cameraFollowPath,
  cameraTilt,
  cameraTransform,
  focusAt,
  followFocusAt,
  followMinCutoff,
  maxFollowSpeed,
  parallaxOffset,
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

describe("camera follow path", () => {
  const follow = region({ startMs: 0, endMs: 4000, focus: { mode: "follow", x: 0.5, y: 0.5 } });
  // Cursor jumps from 0.2 to 0.8 at t=1000.
  const step = { positionAt: (t: number) => ({ x: t < 1000 ? 0.2 : 0.8, y: 0.5 }) };

  it("maps smoothing to a one-euro min cutoff and maxZoomSpeed to a pan speed", () => {
    expect(followMinCutoff(0)).toBe(FOLLOW_SNAPPY_CUTOFF_HZ);
    expect(followMinCutoff(1)).toBe(FOLLOW_SILKY_CUTOFF_HZ);
    expect(followMinCutoff(Number.NaN)).toBeCloseTo(
      (FOLLOW_SNAPPY_CUTOFF_HZ + FOLLOW_SILKY_CUTOFF_HZ) / 2,
      10,
    );
    expect(maxFollowSpeed(4)).toBeCloseTo(4 * FOLLOW_SPEED_PER_ZOOM_SPEED, 10);
    expect(maxFollowSpeed(-1)).toBe(0);
  });

  it("starts on the cursor, eases toward a jump, then settles", () => {
    const p = buildCameraFollowPath(step.positionAt, 0, 4000, { smoothing: 0.5, maxZoomSpeed: 4 });
    expect(p.positionAt(0).x).toBeCloseTo(0.2, 10);
    // Last grid sample before the jump (the next one, at 1000, already moves).
    expect(p.positionAt(1000 - FOLLOW_SAMPLE_MS).x).toBeCloseTo(0.2, 6);
    const shortly = p.positionAt(1100).x;
    expect(shortly).toBeGreaterThan(0.2);
    expect(shortly).toBeLessThan(0.8);
    expect(p.positionAt(4000).x).toBeCloseTo(0.8, 2);
    // Clamped outside the range.
    expect(p.positionAt(-50)).toEqual(p.positionAt(0));
    expect(p.positionAt(9e9)).toEqual(p.positionAt(4000));
  });

  it("never moves faster than maxZoomSpeed allows", () => {
    for (const maxZoomSpeed of [0.5, 2, 10]) {
      const p = buildCameraFollowPath(step.positionAt, 0, 4000, { smoothing: 0, maxZoomSpeed });
      const limit = maxFollowSpeed(maxZoomSpeed);
      for (let t = FOLLOW_SAMPLE_MS; t <= 4000; t += FOLLOW_SAMPLE_MS) {
        const a = p.positionAt(t - FOLLOW_SAMPLE_MS);
        const b = p.positionAt(t);
        const v = Math.hypot(b.x - a.x, b.y - a.y) / (FOLLOW_SAMPLE_MS / 1000);
        expect(v).toBeLessThanOrEqual(limit + 1e-9);
      }
    }
  });

  it("more smoothing removes more jitter", () => {
    // Small 6 Hz hand jitter around 0.5: well under the speed limit.
    const jitter = (t: number) => ({
      x: 0.5 + 0.01 * Math.sin((2 * Math.PI * 6 * t) / 1000),
      y: 0.5,
    });
    const swing = (smoothing: number): number => {
      const p = buildCameraFollowPath(jitter, 0, 4000, { smoothing, maxZoomSpeed: 10 });
      let lo = 1;
      let hi = 0;
      for (let t = 2000; t <= 4000; t += FOLLOW_SAMPLE_MS) {
        const x = p.positionAt(t).x;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      return hi - lo;
    };
    expect(swing(1)).toBeLessThan(swing(0) * 0.5);
    expect(swing(0)).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it("is a pure function of tMs and caches per track, mapping, region and settings", () => {
    const settings = { smoothing: 0.4, maxZoomSpeed: 3 };
    const a = cameraFollowPath(follow, step, settings);
    expect(cameraFollowPath(follow, step, settings)).toBe(a);
    expect(cameraFollowPath(follow, step, { ...settings, smoothing: 0.9 })).not.toBe(a);
    expect(cameraFollowPath({ ...follow, endMs: 3000 }, step, settings)).not.toBe(a);
    const shift = (t: number) => t + 500;
    expect(cameraFollowPath(follow, step, settings, shift)).not.toBe(a);
    // Uncached rebuild gives identical values at arbitrary times (order-independent).
    const fresh = buildCameraFollowPath(step.positionAt, 0, 4000, settings);
    for (const t of [3500, 17, 1234.5, 999.9]) {
      expect(a.positionAt(t)).toEqual(fresh.positionAt(t));
    }
  });

  it("followFocusAt: fixed regions ignore the cursor; follow falls back without one", () => {
    expect(followFocusAt(region(), 2000, cursorAt(0.9, 0.1))).toEqual({ x: 0.25, y: 0.75 });
    expect(followFocusAt(follow, 2000, null)).toEqual({ x: 0.5, y: 0.5 });
    const junk = { positionAt: () => ({ x: Number.NaN, y: Number.POSITIVE_INFINITY }) };
    const f = followFocusAt(follow, 2000, junk);
    expect(Number.isFinite(f.x) && Number.isFinite(f.y)).toBe(true);
  });
});

describe("motion effects", () => {
  it("tilt is proportional to velocity, fades in with zoom, and is capped", () => {
    expect(cameraTilt(1, 0, 1)).toEqual({ x: 0, y: 0 });
    expect(cameraTilt(0.5, 0, 2).x).toBeCloseTo(-0.5 * TILT_GAIN, 10);
    expect(cameraTilt(0.5, 0, 1.5).x).toBeCloseTo(-0.25 * TILT_GAIN, 10);
    expect(cameraTilt(100, -100, 3)).toEqual({ x: -TILT_MAX_RAD, y: -TILT_MAX_RAD });
    const junk = cameraTilt(Number.NaN, Number.NaN, Number.NaN);
    expect(Number.isFinite(junk.x) && Number.isFinite(junk.y)).toBe(true);
  });

  it("parallax offsets opposite the pivot delta and stays inside the overscan", () => {
    const c = cameraTransform({ level: 2, focus: { x: 0, y: 1 }, contentW: 800, contentH: 400 });
    const o = parallaxOffset(c);
    expect(o.x).toBeCloseTo(-(c.pivotX - 400) * PARALLAX_FACTOR, 10);
    expect(o.y).toBeCloseTo(-(c.pivotY - 200) * PARALLAX_FACTOR, 10);
    expect(Math.abs(o.x)).toBeLessThanOrEqual(((PARALLAX_OVERSCAN - 1) / 2) * 800);
    expect(
      parallaxOffset(
        cameraTransform({ level: 1, focus: { x: 0, y: 0 }, contentW: 800, contentH: 400 }),
      ),
    ).toEqual({ x: 0, y: 0 });
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
