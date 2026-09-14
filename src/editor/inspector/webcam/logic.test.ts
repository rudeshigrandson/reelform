import { describe, expect, it } from "vitest";
import { ANCHORS } from "../controls";
import {
  MIN_CROP_PX,
  PILL_ASPECT,
  bubbleCornerRadius,
  bubbleRect,
  clampCrop,
  clampSyncOffset,
  cropFromZoom,
  cropToView,
  fitCrop,
  formatDuration,
  shapeAspect,
  zoomReactiveScale,
} from "./logic";
import { DEFAULT_WEBCAM_SETTINGS, webcamSettingsSchema } from "./types";

const FRAME = { width: 1920, height: 1080 };
const base = DEFAULT_WEBCAM_SETTINGS;

const inside = (r: { x: number; y: number; w: number; h: number }, f = FRAME) => {
  expect(r.x).toBeGreaterThanOrEqual(-1e-9);
  expect(r.y).toBeGreaterThanOrEqual(-1e-9);
  expect(r.x + r.w).toBeLessThanOrEqual(f.width + 1e-9);
  expect(r.y + r.h).toBeLessThanOrEqual(f.height + 1e-9);
};

describe("defaults", () => {
  it("validate against the schema", () => {
    expect(webcamSettingsSchema.safeParse(base).success).toBe(true);
  });
  it("schema rejects bad anchor and out-of-range size", () => {
    expect(webcamSettingsSchema.safeParse({ ...base, anchor: "middle" }).success).toBe(false);
    expect(webcamSettingsSchema.safeParse({ ...base, sizePct: 60 }).success).toBe(false);
    expect(webcamSettingsSchema.safeParse({ ...base, anchor: null }).success).toBe(true);
  });
});

describe("bubbleRect", () => {
  it("sizes by percent of frame height and places bottom-left with margin", () => {
    const r = bubbleRect(FRAME, { ...base, sizePct: 20, marginPx: 32, anchor: "bottom-left" });
    expect(r.h).toBeCloseTo(216);
    expect(r.w).toBeCloseTo(216);
    expect(r.x).toBeCloseTo(32);
    expect(r.y).toBeCloseTo(1080 - 32 - 216);
  });

  it("centers on the center anchor and hugs top-right", () => {
    const c = bubbleRect(FRAME, { ...base, anchor: "center" });
    expect(c.x + c.w / 2).toBeCloseTo(960);
    expect(c.y + c.h / 2).toBeCloseTo(540);
    const tr = bubbleRect(FRAME, { ...base, anchor: "top-right", marginPx: 10 });
    expect(tr.x + tr.w).toBeCloseTo(1910);
    expect(tr.y).toBeCloseTo(10);
  });

  it("stays inside the frame for every anchor, shape and extreme size", () => {
    for (const anchor of ANCHORS) {
      for (const shape of ["circle", "rounded", "square", "pill"] as const) {
        inside(bubbleRect(FRAME, { ...base, anchor, shape, sizePct: 50, marginPx: 200 }));
      }
    }
  });

  it("pill uses 16:9 width", () => {
    const r = bubbleRect(FRAME, { ...base, shape: "pill", sizePct: 20 });
    expect(r.w / r.h).toBeCloseTo(PILL_ASPECT);
  });

  it("shrinks to fit a narrow (vertical) frame", () => {
    const tall = { width: 300, height: 1920 };
    const r = bubbleRect(tall, { ...base, shape: "pill", sizePct: 50, marginPx: 200 });
    expect(r.w).toBeLessThanOrEqual(300);
    inside(r, tall);
  });

  it("clamps custom positions near edges and out-of-range sizes", () => {
    const r = bubbleRect(FRAME, { ...base, anchor: null, customX: 1, customY: 0, marginPx: 20 });
    expect(r.x + r.w).toBeCloseTo(1900);
    expect(r.y).toBeCloseTo(20);
    const small = bubbleRect(FRAME, { ...base, sizePct: 1 });
    expect(small.h).toBeCloseTo(108);
    const mid = bubbleRect(FRAME, { ...base, anchor: null, customX: 0.5, customY: 0.5 });
    expect(mid.x + mid.w / 2).toBeCloseTo(960);
  });

  it("handles degenerate frames and NaN input without escaping", () => {
    const zero = bubbleRect({ width: 0, height: 0 }, base);
    expect(zero).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    const nan = bubbleRect(FRAME, {
      ...base,
      anchor: null,
      customX: Number.NaN,
      marginPx: Number.NaN,
    });
    inside(nan);
  });
});

describe("bubbleCornerRadius", () => {
  const rect = { w: 200, h: 200 };
  it("maps shapes to radii", () => {
    expect(bubbleCornerRadius("circle", 24, rect)).toBe(100);
    expect(bubbleCornerRadius("square", 24, rect)).toBe(0);
    expect(bubbleCornerRadius("rounded", 24, rect)).toBe(24);
    expect(bubbleCornerRadius("rounded", 500, rect)).toBe(100);
    expect(bubbleCornerRadius("pill", 0, { w: 320, h: 180 })).toBe(90);
  });
});

describe("zoomReactiveScale", () => {
  it("follows 1 / (1 + (z-1)*0.5)", () => {
    expect(zoomReactiveScale(1, true)).toBe(1);
    expect(zoomReactiveScale(2, true)).toBeCloseTo(1 / 1.5);
    expect(zoomReactiveScale(3, true)).toBeCloseTo(0.5);
  });
  it("is identity when off, and never grows for z < 1 or NaN", () => {
    expect(zoomReactiveScale(3, false)).toBe(1);
    expect(zoomReactiveScale(0.5, true)).toBe(1);
    expect(zoomReactiveScale(Number.NaN, true)).toBe(1);
  });
});

describe("clampSyncOffset", () => {
  it("rounds and clamps to ±5000", () => {
    expect(clampSyncOffset(123.6)).toBe(124);
    expect(clampSyncOffset(99999)).toBe(5000);
    expect(clampSyncOffset(-99999)).toBe(-5000);
    expect(clampSyncOffset(Number.NaN)).toBe(0);
  });
});

describe("crop", () => {
  const SRC = { width: 1280, height: 720 };

  it("fitCrop is the largest centered rect at the aspect", () => {
    expect(fitCrop(SRC, 1)).toEqual({ x: 280, y: 0, w: 720, h: 720 });
    const pill = fitCrop(SRC, PILL_ASPECT);
    expect(pill.w).toBeCloseTo(1280);
    expect(pill.h).toBeCloseTo(720);
    expect(shapeAspect("square")).toBe(1);
  });

  it("cropFromZoom zooms around the center and stays in source", () => {
    const c = cropFromZoom(SRC, 1, 2, { x: 0.5, y: 0.5 });
    expect(c).toEqual({ x: 460, y: 180, w: 360, h: 360 });
    const edge = cropFromZoom(SRC, 1, 2, { x: 0, y: 1 });
    expect(edge.x).toBe(0);
    expect(edge.y + edge.h).toBe(720);
  });

  it("cropFromZoom clamps zoom to 1–4", () => {
    expect(cropFromZoom(SRC, 1, 0.1, { x: 0.5, y: 0.5 }).w).toBe(720);
    expect(cropFromZoom(SRC, 1, 99, { x: 0.5, y: 0.5 }).w).toBe(180);
  });

  it("clampCrop pulls rects back inside source and enforces min size", () => {
    expect(clampCrop({ x: 1200, y: -50, w: 400, h: 400 }, SRC)).toEqual({
      x: 880,
      y: 0,
      w: 400,
      h: 400,
    });
    expect(clampCrop({ x: 0, y: 0, w: 5000, h: 5000 }, SRC)).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
    });
    const tiny = clampCrop({ x: 10, y: 10, w: 1, h: 1 }, SRC);
    expect(tiny.w).toBe(MIN_CROP_PX);
    expect(clampCrop({ x: Number.NaN, y: 0, w: Number.NaN, h: 100 }, SRC).w).toBe(1280);
  });

  it("cropToView round-trips cropFromZoom and handles null", () => {
    expect(cropToView(null, SRC, 1)).toEqual({ zoom: 1, center: { x: 0.5, y: 0.5 } });
    const c = cropFromZoom(SRC, 1, 2.5, { x: 0.4, y: 0.6 });
    const v = cropToView(c, SRC, 1);
    expect(v.zoom).toBeCloseTo(2.5);
    const again = cropFromZoom(SRC, 1, v.zoom, v.center);
    expect(again.x).toBeCloseTo(c.x);
    expect(again.y).toBeCloseTo(c.y);
  });
});

describe("formatDuration", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatDuration(42_000)).toBe("00:42");
    expect(formatDuration(62_900)).toBe("01:02");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(-5)).toBe("00:00");
  });
});
