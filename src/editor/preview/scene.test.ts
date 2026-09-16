import { describe, expect, it } from "vitest";
import { DEFAULT_CURSOR_SETTINGS } from "../inspector/cursor/types";
import { DEFAULT_FRAME_SETTINGS, type FrameSettings } from "../inspector/frame/types";
import { DEFAULT_ZOOM_SETTINGS, type ZoomRegion } from "../inspector/zoom/types";
import { PARALLAX_FACTOR, PARALLAX_OVERSCAN, TILT_MAX_RAD, cameraFollowPath } from "./camera";
import { buildSmoothedCursorTrack } from "./cursorSmoothing";
import {
  CURSOR_BASE_PX,
  type SceneInput,
  evaluateScene,
  resolveBackgroundPaint,
  wallpaperFallbackPaint,
} from "./scene";
import { CUT_ZOOM_PEAK } from "./transitions";

const zoom: ZoomRegion = {
  id: "z",
  startMs: 1000,
  endMs: 5000,
  level: 2,
  focus: { mode: "follow", x: 0.5, y: 0.5 },
  easeInMs: 500,
  easeOutMs: 500,
  curve: "ease-out-cubic",
  source: "manual",
};

const track = buildSmoothedCursorTrack([
  { tMs: 0, x: 0.2, y: 0.3 },
  { tMs: 3000, x: 0.6, y: 0.7 },
  { tMs: 6000, x: 0.4, y: 0.4 },
]);

const input = (patch: Partial<SceneInput> = {}): SceneInput => ({
  canvas: { width: 1920, height: 1080 },
  frame: structuredClone(DEFAULT_FRAME_SETTINGS),
  sourceSize: { width: 2880, height: 1800 },
  zoomRegions: [zoom],
  cursor: structuredClone(DEFAULT_CURSOR_SETTINGS),
  cursorTrack: track,
  hasVideo: true,
  ...patch,
});

const bg = (patch: Partial<FrameSettings["background"]>): FrameSettings["background"] => ({
  ...structuredClone(DEFAULT_FRAME_SETTINGS.background),
  ...patch,
});

describe("evaluateScene", () => {
  it("is deterministic", () => {
    for (const t of [0, 1200, 3000, 4900, 8000]) {
      expect(evaluateScene(input(), t)).toEqual(evaluateScene(input(), t));
    }
  });

  it("reports the active camera level and region", () => {
    const s = evaluateScene(input(), 3000);
    expect(s.camera.level).toBe(2);
    expect(s.camera.regionId).toBe("z");
    expect(evaluateScene(input(), 0).camera).toMatchObject({ level: 1, regionId: null });
  });

  it("hides the cursor without a track or when show=false", () => {
    expect(evaluateScene(input({ cursorTrack: null }), 2000).cursor.visible).toBe(false);
    expect(evaluateScene(input({ cursorTrack: undefined }), 2000).cursor.visible).toBe(false);
    const hidden = input();
    hidden.cursor.show = false;
    expect(evaluateScene(hidden, 2000).cursor.visible).toBe(false);
    expect(evaluateScene(input(), 2000).cursor.visible).toBe(true);
  });

  it("positions the cursor in content-local px", () => {
    const s = evaluateScene(input(), 0);
    expect(s.cursor.x).toBeCloseTo(0.2 * s.layout.content.width, 6);
    expect(s.cursor.y).toBeCloseTo(0.3 * s.layout.content.height, 6);
  });

  it("cursor size is inverse to zoom", () => {
    const out = evaluateScene(input(), 0);
    const inZoom = evaluateScene(input(), 3000);
    expect(out.cursor.size).toBeCloseTo(CURSOR_BASE_PX * out.layout.scale, 6);
    expect(inZoom.cursor.size).toBeCloseTo(out.cursor.size / 2, 6);
    // Apparent size (× camera scale) is preserved.
    expect(inZoom.cursor.size * inZoom.camera.scale).toBeCloseTo(out.cursor.size, 6);
  });

  it("cursor size follows the size% setting", () => {
    const big = input();
    big.cursor.size = 200;
    expect(evaluateScene(big, 0).cursor.size).toBeCloseTo(
      2 * evaluateScene(input(), 0).cursor.size,
      6,
    );
  });

  it("follow zoom reads the smoothed, speed-limited camera path", () => {
    const s = evaluateScene(input(), 3000);
    const path = cameraFollowPath(zoom, track, DEFAULT_ZOOM_SETTINGS.camera);
    expect(s.camera.focus.x).toBeCloseTo(path.positionAt(3000).x, 10);
    // Lags the raw cursor but stays near it.
    expect(Math.abs(s.camera.focus.x - track.positionAt(3000).x)).toBeLessThan(0.05);
  });

  it("follow zoom honours camera.smoothing and maxZoomSpeed", () => {
    const snappy = evaluateScene(input({ camera: { smoothing: 0, maxZoomSpeed: 10 } }), 1500);
    const silky = evaluateScene(input({ camera: { smoothing: 1, maxZoomSpeed: 10 } }), 1500);
    const raw = track.positionAt(1500).x;
    expect(Math.abs(silky.camera.focus.x - raw)).toBeGreaterThan(
      Math.abs(snappy.camera.focus.x - raw),
    );
    const slow = evaluateScene(input({ camera: { smoothing: 0, maxZoomSpeed: 0.5 } }), 1500);
    expect(Math.abs(slow.camera.focus.x - raw)).toBeGreaterThan(
      Math.abs(snappy.camera.focus.x - raw),
    );
  });

  it("scale with zoom keeps the cursor growing with the camera", () => {
    const grow = input();
    grow.cursor.scaleWithZoom = true;
    const out = evaluateScene(grow, 0);
    const inZoom = evaluateScene(grow, 3000);
    expect(inZoom.cursor.size).toBeCloseTo(out.cursor.size, 6);
    expect(inZoom.cursor.size).toBeCloseTo(CURSOR_BASE_PX * inZoom.layout.scale, 6);
  });

  it("3D tilt is zero when off, at 1×, or with a still camera", () => {
    const off = evaluateScene(input(), 3000);
    expect([off.camera.tiltX, off.camera.tiltY]).toEqual([0, 0]);
    const on = evaluateScene(input({ cameraMotion: { tilt3d: true, parallax: false } }), 0);
    expect([on.camera.tiltX, on.camera.tiltY]).toEqual([0, 0]);
    const fixed = evaluateScene(
      input({
        cameraMotion: { tilt3d: true, parallax: false },
        zoomRegions: [{ ...zoom, focus: { mode: "fixed", x: 0.3, y: 0.3 } }],
      }),
      3000,
    );
    expect([fixed.camera.tiltX, fixed.camera.tiltY]).toEqual([0, 0]);
  });

  it("3D tilt leans against horizontal camera motion within the max skew", () => {
    const s = evaluateScene(input({ cameraMotion: { tilt3d: true, parallax: false } }), 2500);
    // Cursor moves right (+x) here → negative lean.
    expect(s.camera.tiltX).toBeLessThan(0);
    expect(Math.abs(s.camera.tiltX)).toBeLessThanOrEqual(TILT_MAX_RAD);
    expect(evaluateScene(input({ cameraMotion: { tilt3d: true, parallax: false } }), 2500)).toEqual(
      s,
    );
  });

  it("parallax offsets the background opposite the pivot delta with overscan", () => {
    const s = evaluateScene(input({ cameraMotion: { tilt3d: false, parallax: true } }), 3000);
    expect(s.background.scale).toBe(PARALLAX_OVERSCAN);
    expect(s.background.offsetX).toBeCloseTo(
      -(s.camera.pivotX - s.camera.positionX) * PARALLAX_FACTOR,
      10,
    );
    const off = evaluateScene(input(), 3000).background;
    expect([off.offsetX, off.offsetY, off.scale]).toEqual([0, 0, 1]);
  });

  it("cut-with-zoom bumps the camera scale around a clip boundary", () => {
    const clips = [
      { id: "a", sourceStartMs: 0, sourceEndMs: 3000, timelineStartMs: 0 },
      { id: "b", sourceStartMs: 4000, sourceEndMs: 8000, timelineStartMs: 3000 },
    ];
    const transition = { kind: "cut-with-zoom" as const, durationMs: 400, clips };
    const plain = input({ zoomRegions: [] });
    const at = evaluateScene({ ...plain, transition }, 3000);
    expect(at.camera.scale).toBeCloseTo(CUT_ZOOM_PEAK, 10);
    expect(at.transition?.kind).toBe("cut-with-zoom");
    expect(evaluateScene({ ...plain, transition }, 2500).camera.scale).toBe(1);
    expect(evaluateScene({ ...plain, transition }, 2900).camera.scale).toBeGreaterThan(1);
  });

  it("marks video hidden when no video is attached", () => {
    expect(evaluateScene(input({ hasVideo: false }), 0).video.visible).toBe(false);
  });

  it("survives a zero canvas and NaN time", () => {
    const s = evaluateScene(input({ canvas: { width: 0, height: 0 } }), Number.NaN);
    expect(s.tMs).toBe(0);
    expect(Number.isFinite(s.cursor.size)).toBe(true);
  });
});

describe("resolveBackgroundPaint", () => {
  it("color → solid", () => {
    expect(resolveBackgroundPaint(bg({ kind: "color", color: "#123456" }))).toEqual({
      kind: "solid",
      color: "#123456",
    });
  });

  it("gradient → sorted linear stops with angle", () => {
    const paint = resolveBackgroundPaint(
      bg({
        kind: "gradient",
        gradient: {
          type: "linear",
          angle: 90,
          stops: [
            { color: "#ffffff", position: 100 },
            { color: "#000000", position: 0 },
            { color: "#ff0000", position: 50 },
          ],
        },
      }),
    );
    expect(paint).toEqual({
      kind: "linear-gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 0.5, color: "#ff0000" },
        { offset: 1, color: "#ffffff" },
      ],
    });
  });

  it("gradient radial → radial stops", () => {
    const b = bg({ kind: "gradient" });
    b.gradient.type = "radial";
    const paint = resolveBackgroundPaint(b);
    expect(paint.kind).toBe("radial-gradient");
  });

  it("wallpaper → deterministic fallback gradient per id", () => {
    const a = resolveBackgroundPaint(bg({ kind: "wallpaper", wallpaperId: "mesh-1" }));
    expect(a).toEqual(wallpaperFallbackPaint("mesh-1"));
    expect(a).toEqual(resolveBackgroundPaint(bg({ kind: "wallpaper", wallpaperId: "mesh-1" })));
    expect(a).not.toEqual(wallpaperFallbackPaint("abstract-2"));
    if (a.kind !== "linear-gradient") throw new Error("expected gradient");
    for (const s of a.stops) expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("image with null path → color; with path → image + fallback", () => {
    expect(resolveBackgroundPaint(bg({ kind: "image", color: "#abcdef" }))).toEqual({
      kind: "solid",
      color: "#abcdef",
    });
    expect(
      resolveBackgroundPaint(
        bg({ kind: "image", color: "#abcdef", image: { path: "media/bg.png", fit: "fit" } }),
      ),
    ).toEqual({ kind: "image", path: "media/bg.png", fit: "fit", fallbackColor: "#abcdef" });
  });

  it("none → transparent", () => {
    expect(resolveBackgroundPaint(bg({ kind: "none" }))).toEqual({ kind: "transparent" });
  });

  it("blur applies only to wallpaper/image backgrounds", () => {
    const f = structuredClone(DEFAULT_FRAME_SETTINGS);
    f.blur = 20;
    expect(evaluateScene(input({ frame: f }), 0).background.blur).toBeGreaterThan(0);
    f.background.kind = "color";
    expect(evaluateScene(input({ frame: f }), 0).background.blur).toBe(0);
  });
});
