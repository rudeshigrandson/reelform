import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ANCHORS } from "../../inspector/controls";
import {
  DEFAULT_WEBCAM_SETTINGS,
  WEBCAM_SHAPES,
  type WebcamSettings,
} from "../../inspector/webcam/types";
import { type FakeContainer, FakeGraphics, FakeSprite, fakePixi } from "./fakePixi";
import { cameraAt, layoutFor } from "./testFixtures";
import { createWebcamLayer, evaluateWebcamLayer, webcamVisibleAt } from "./webcamLayer";

const settings = (patch: Partial<WebcamSettings> = {}): WebcamSettings => ({
  ...structuredClone(DEFAULT_WEBCAM_SETTINGS),
  ...patch,
});
const layout = layoutFor();
const input = (patch: Partial<WebcamSettings> = {}) => ({
  settings: settings(patch),
  hasWebcam: true,
  sourceSize: { width: 1280, height: 720 },
});

describe("webcamVisibleAt", () => {
  it("defaults to the whole timeline and honors half-open regions", () => {
    expect(webcamVisibleAt(undefined, 5)).toBe(true);
    expect(webcamVisibleAt([], 5)).toBe(true);
    const regions = [
      { startMs: 0, endMs: 100 },
      { startMs: 500, endMs: 600 },
    ];
    expect(webcamVisibleAt(regions, 99)).toBe(true);
    expect(webcamVisibleAt(regions, 100)).toBe(false);
    expect(webcamVisibleAt(regions, 550)).toBe(true);
  });
});

describe("evaluateWebcamLayer", () => {
  it("sizes the bubble as % of frame height and anchors with scaled margin", () => {
    const s = evaluateWebcamLayer(
      input({ sizePct: 20, anchor: "bottom-left", marginPx: 32 }),
      0,
      layout,
      cameraAt(1),
    );
    const H = layout.frame.height;
    expect(s.rect.height).toBeCloseTo(0.2 * H, 9);
    expect(s.rect.width).toBeCloseTo(0.2 * H, 9);
    expect(s.rect.x).toBeCloseTo(32 * layout.scale, 9);
    expect(s.rect.y + s.rect.height).toBeCloseTo(H - 32 * layout.scale, 9);
    expect(s.cornerRadius).toBeCloseTo(s.rect.width / 2, 9);
    expect(s.visible).toBe(true);
  });

  it("zoom-reactive shrink 1/(1+(z-1)*0.5) keeps the anchored corner", () => {
    const base = evaluateWebcamLayer(input({ anchor: "bottom-right" }), 0, layout, cameraAt(1));
    const z = evaluateWebcamLayer(input({ anchor: "bottom-right" }), 0, layout, cameraAt(3));
    expect(z.scale).toBeCloseTo(0.5, 12);
    expect(z.rect.width).toBeCloseTo(base.rect.width * 0.5, 9);
    expect(z.rect.x + z.rect.width).toBeCloseTo(base.rect.x + base.rect.width, 9);
    expect(z.rect.y + z.rect.height).toBeCloseTo(base.rect.y + base.rect.height, 9);
    const off = evaluateWebcamLayer(input({ zoomReactive: false }), 0, layout, cameraAt(3));
    expect(off.scale).toBe(1);
  });

  it("hides when disabled, missing, or outside visibility regions", () => {
    const cam = cameraAt(1);
    expect(evaluateWebcamLayer(input({ enabled: false }), 0, layout, cam).visible).toBe(false);
    expect(evaluateWebcamLayer({ ...input(), hasWebcam: false }, 0, layout, cam).visible).toBe(
      false,
    );
    const regions = [{ startMs: 1000, endMs: 2000 }];
    expect(evaluateWebcamLayer({ ...input(), regions }, 500, layout, cam).visible).toBe(false);
    expect(evaluateWebcamLayer({ ...input(), regions }, 1500, layout, cam).visible).toBe(true);
  });

  it("uses the explicit crop, else a centered crop at the shape aspect", () => {
    const cam = cameraAt(1);
    const auto = evaluateWebcamLayer(input({ shape: "circle" }), 0, layout, cam);
    expect(auto.crop).toEqual({ x: 280, y: 0, w: 720, h: 720 });
    const explicit = evaluateWebcamLayer(
      input({ crop: { x: 10, y: 20, w: 300, h: 300 } }),
      0,
      layout,
      cam,
    );
    expect(explicit.crop).toEqual({ x: 10, y: 20, w: 300, h: 300 });
    expect(evaluateWebcamLayer({ ...input(), sourceSize: null }, 0, layout, cam).crop).toBeNull();
  });

  it("property: bubble rect stays inside the frame for all positions/sizes/zooms", () => {
    fc.assert(
      fc.property(
        fc.record({
          shape: fc.constantFrom(...WEBCAM_SHAPES),
          sizePct: fc.double({ min: -10, max: 80, noNaN: true }),
          anchor: fc.option(fc.constantFrom(...ANCHORS), { nil: null }),
          customX: fc.double({ min: -1, max: 2, noNaN: true }),
          customY: fc.double({ min: -1, max: 2, noNaN: true }),
          marginPx: fc.double({ min: 0, max: 400, noNaN: true }),
        }),
        fc.integer({ min: 50, max: 4000 }),
        fc.integer({ min: 50, max: 4000 }),
        fc.double({ min: 1, max: 8, noNaN: true }),
        (patch, cw, ch, zoom) => {
          const l = layoutFor({ width: cw, height: ch });
          const s = evaluateWebcamLayer(input(patch), 0, l, cameraAt(zoom));
          const eps = 1e-6;
          expect(s.rect.x).toBeGreaterThanOrEqual(-eps);
          expect(s.rect.y).toBeGreaterThanOrEqual(-eps);
          expect(s.rect.x + s.rect.width).toBeLessThanOrEqual(l.frame.width + eps);
          expect(s.rect.y + s.rect.height).toBeLessThanOrEqual(l.frame.height + eps);
          expect(s.cornerRadius).toBeLessThanOrEqual(
            Math.min(s.rect.width, s.rect.height) / 2 + eps,
          );
        },
      ),
    );
  });
});

describe("createWebcamLayer (fake pixi)", () => {
  it("masks, mirrors and maps the crop onto the bubble", () => {
    const layer = createWebcamLayer(fakePixi);
    const sprite = new FakeSprite({ label: "cam" });
    layer.setSprite(sprite);
    const s = evaluateWebcamLayer(input({ mirror: true, borderWidth: 4 }), 0, layout, cameraAt(1));
    layer.apply(s);
    const root = layer.container as FakeContainer;
    const [, video, mask, border] = root.children;
    expect(video?.mask).toBe(mask);
    expect(video?.scale.x).toBe(-1);
    expect(video?.position.x).toBeCloseTo(s.rect.x + s.rect.width, 9);
    expect((mask as FakeGraphics).opNames()).toEqual(["roundRect", "fill"]);
    expect((border as FakeGraphics).opNames()).toEqual(["roundRect", "stroke"]);
    const kx = s.rect.width / 720;
    expect(sprite.width).toBeCloseTo(1280 * kx, 9);
    expect(sprite.position.x).toBeCloseTo(-280 * kx, 9);
    expect(sprite.visible).toBe(true);
    expect(video?.children[0]?.visible).toBe(false);

    layer.apply({ ...s, visible: false });
    expect(root.visible).toBe(false);
    layer.setSprite(null);
    expect(video?.children).not.toContain(sprite);
  });

  it("shows the placeholder without a sprite", () => {
    const layer = createWebcamLayer(fakePixi);
    layer.apply(evaluateWebcamLayer(input(), 0, layout, cameraAt(1)));
    const video = (layer.container as FakeContainer).children[1];
    const placeholder = video?.children[0];
    expect(placeholder).toBeInstanceOf(FakeGraphics);
    expect(placeholder?.visible).toBe(true);
  });
});
