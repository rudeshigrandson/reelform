import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FRAME_SETTINGS } from "../../inspector/frame/types";
import { bubbleRect } from "../../inspector/webcam/logic";
import { cameraTransform } from "../camera";
import { computeFrameLayout } from "../layout";
import {
  IDENTITY_CAMERA,
  canvasToContentLocal,
  canvasToContentNorm,
  canvasToFrameNorm,
  contentLocalToCanvas,
  contentNormToCanvas,
  frameNormToCanvas,
} from "./coords";
import {
  FULL_CROP,
  MIN_CROP,
  clampCropRect,
  moveCrop,
  normalizeCrop,
  resizeCrop,
} from "./cropMath";
import {
  type GizmoBox,
  HANDLES,
  type HandleId,
  handlePoint,
  moveBox,
  normalizeDeg,
  resizeBox,
  rotationFromPointer,
} from "./gizmoMath";
import { WEBCAM_SNAP_PX, webcamDropPosition, webcamGrid } from "./webcamDrag";

const OPPOSITE: Record<HandleId, HandleId> = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};

const boxArb = fc.record({
  x: fc.double({ min: -500, max: 500, noNaN: true }),
  y: fc.double({ min: -500, max: 500, noNaN: true }),
  width: fc.double({ min: 10, max: 400, noNaN: true }),
  height: fc.double({ min: 10, max: 400, noNaN: true }),
  rotation: fc.double({ min: -180, max: 180, noNaN: true }),
});
const delta = fc.double({ min: -300, max: 300, noNaN: true });

describe("gizmo math", () => {
  it("move keeps size and rotation", () => {
    fc.assert(
      fc.property(boxArb, delta, delta, (b, dx, dy) => {
        const m = moveBox(b, dx, dy);
        expect(m.width).toBe(b.width);
        expect(m.rotation).toBe(b.rotation);
        expect(m.x - b.x).toBeCloseTo(dx);
      }),
    );
  });

  it("resize keeps the opposite handle fixed and respects min size (any rotation)", () => {
    fc.assert(
      fc.property(
        boxArb,
        fc.constantFrom(...HANDLES),
        delta,
        delta,
        fc.boolean(),
        (b, h, dx, dy, keepAspect) => {
          const r = resizeBox(b, h, dx, dy, { minSize: 4, keepAspect });
          expect(r.width).toBeGreaterThanOrEqual(4 - 1e-9);
          expect(r.height).toBeGreaterThanOrEqual(4 - 1e-9);
          expect(r.rotation).toBe(b.rotation);
          const before = handlePoint(b, OPPOSITE[h]);
          const after = handlePoint(r, OPPOSITE[h]);
          expect(after.x).toBeCloseTo(before.x, 6);
          expect(after.y).toBeCloseTo(before.y, 6);
        },
      ),
    );
  });

  it("corner resize with keepAspect preserves the ratio", () => {
    fc.assert(
      fc.property(
        boxArb,
        fc.constantFrom<HandleId>("nw", "ne", "se", "sw"),
        delta,
        delta,
        (b, h, dx, dy) => {
          const r = resizeBox(b, h, dx, dy, { keepAspect: true, minSize: 4 });
          expect(r.width / r.height).toBeCloseTo(b.width / b.height, 6);
        },
      ),
    );
  });

  it("dragging the se handle of an unrotated box grows it by the delta", () => {
    const b: GizmoBox = { x: 10, y: 10, width: 100, height: 50, rotation: 0 };
    expect(resizeBox(b, "se", 20, 10)).toEqual({
      x: 10,
      y: 10,
      width: 120,
      height: 60,
      rotation: 0,
    });
    expect(resizeBox(b, "n", 999, -10)).toEqual({
      x: 10,
      y: 0,
      width: 100,
      height: 60,
      rotation: 0,
    });
  });

  it("rotation: pointer straight up is 0°, right is 90°, snapping and normalization", () => {
    const b: GizmoBox = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    expect(rotationFromPointer(b, { x: 50, y: -100 })).toBeCloseTo(0);
    expect(rotationFromPointer(b, { x: 200, y: 50 })).toBeCloseTo(90);
    expect(rotationFromPointer(b, { x: 200, y: 58 }, true)).toBe(90);
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (d) => {
        const n = normalizeDeg(d);
        expect(n).toBeGreaterThan(-180);
        expect(n).toBeLessThanOrEqual(180);
      }),
    );
  });
});

const rectArb = fc
  .record({
    x: fc.double({ min: 0, max: 0.9, noNaN: true }),
    y: fc.double({ min: 0, max: 0.9, noNaN: true }),
    width: fc.double({ min: MIN_CROP, max: 1, noNaN: true }),
    height: fc.double({ min: MIN_CROP, max: 1, noNaN: true }),
  })
  .map((r) => clampCropRect(r));
const nd = fc.double({ min: -2, max: 2, noNaN: true });

describe("crop math", () => {
  const inside = (r: { x: number; y: number; width: number; height: number }): void => {
    expect(r.x).toBeGreaterThanOrEqual(-1e-9);
    expect(r.y).toBeGreaterThanOrEqual(-1e-9);
    expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
  };

  it("free resize and move stay in bounds with min size", () => {
    fc.assert(
      fc.property(rectArb, fc.constantFrom(...HANDLES), nd, nd, (r, h, dx, dy) => {
        const out = resizeCrop(r, h, dx, dy);
        inside(out);
        expect(out.width).toBeGreaterThanOrEqual(MIN_CROP - 1e-9);
        expect(out.height).toBeGreaterThanOrEqual(MIN_CROP - 1e-9);
        const m = moveCrop(r, dx, dy);
        inside(m);
        expect(m.width).toBeCloseTo(r.width);
      }),
    );
  });

  it("aspect lock keeps w/h and stays in bounds", () => {
    fc.assert(
      fc.property(rectArb, fc.constantFrom(...HANDLES), nd, nd, (r, h, dx, dy) => {
        const aspect = r.width / r.height;
        const out = resizeCrop(r, h, dx, dy, aspect);
        inside(out);
        // Ratio holds unless the minimum forced a clamp in a corner case.
        if (
          out.width > MIN_CROP + 1e-6 &&
          out.height > MIN_CROP + 1e-6 &&
          out.width < 1 - 1e-6 &&
          out.height < 1 - 1e-6
        ) {
          expect(out.width / out.height).toBeCloseTo(aspect, 4);
        }
      }),
    );
  });

  it("dragging e keeps the left edge fixed; full crop normalizes to null", () => {
    const r = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
    const e = resizeCrop(r, "e", 0.1, 0.5);
    expect(e.x).toBeCloseTo(0.2, 9);
    expect(e.y).toBeCloseTo(0.2, 9);
    expect(e.width).toBeCloseTo(0.5, 9);
    expect(e.height).toBeCloseTo(0.4, 9);
    expect(resizeCrop(r, "w", 1, 0).x).toBeCloseTo(0.6 - MIN_CROP);
    expect(normalizeCrop(FULL_CROP)).toBeNull();
    expect(normalizeCrop(null)).toBeNull();
    expect(normalizeCrop(r)).toEqual(r);
  });
});

describe("webcam drag snapping", () => {
  const frame = { width: 1920, height: 1080 };
  const size = { w: 216, h: 216 };

  it("snapping both axes to grid cells yields every anchor that bubbleRect would place", () => {
    for (const anchor of [
      "top-left",
      "top",
      "top-right",
      "left",
      "center",
      "right",
      "bottom-left",
      "bottom",
      "bottom-right",
    ] as const) {
      const r = bubbleRect(frame, {
        shape: "circle",
        sizePct: 20,
        anchor,
        customX: 0,
        customY: 0,
        marginPx: 32,
      });
      const out = webcamDropPosition({ x: r.x + 3, y: r.y - 4, w: r.w, h: r.h }, frame, 32);
      expect(out.anchor).toBe(anchor);
      expect(out.rect.x).toBeCloseTo(r.x);
      expect(out.rect.y).toBeCloseTo(r.y);
      expect(out.guides.vertical).toHaveLength(1);
    }
  });

  it("away from the grid stores a custom center; one-axis snap draws one guide", () => {
    const { xs } = webcamGrid(frame, size, 32);
    const out = webcamDropPosition({ x: 700, y: 300, ...size }, frame, 32);
    expect(out.anchor).toBeNull();
    expect(out.customX).toBeCloseTo((700 + 108) / 1920);
    const half = webcamDropPosition({ x: xs[1] + WEBCAM_SNAP_PX - 1, y: 300, ...size }, frame, 32);
    expect(half.anchor).toBeNull();
    expect(half.guides).toEqual({ vertical: [960], horizontal: [] });
  });

  it("clamps drags outside the frame", () => {
    const out = webcamDropPosition({ x: -500, y: 5000, ...size }, frame, 0);
    expect(out.rect.x).toBe(0);
    expect(out.rect.y).toBe(1080 - 216);
    expect(out.anchor).toBe("bottom-left");
  });
});

describe("coords", () => {
  const layout = computeFrameLayout(
    { width: 1000, height: 700 },
    structuredClone(DEFAULT_FRAME_SETTINGS),
    { width: 1920, height: 1080 },
  );
  const cam = cameraTransform({
    level: 2,
    focus: { x: 0.3, y: 0.6 },
    contentW: layout.content.width,
    contentH: layout.content.height,
  });
  const pt = fc.record({
    x: fc.double({ min: -1, max: 2, noNaN: true }),
    y: fc.double({ min: -1, max: 2, noNaN: true }),
  });

  it("round-trips frame-normalized and content coords through the camera", () => {
    fc.assert(
      fc.property(pt, fc.boolean(), (p, follow) => {
        const back = canvasToFrameNorm(
          frameNormToCanvas(p, layout, cam, follow),
          layout,
          cam,
          follow,
        );
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
        const q = canvasToContentLocal(contentLocalToCanvas(p, layout, cam), layout, cam);
        expect(q.x).toBeCloseTo(p.x, 6);
        const n = canvasToContentNorm(contentNormToCanvas(p, layout), layout);
        expect(n.y).toBeCloseTo(p.y, 6);
      }),
    );
  });

  it("identity camera maps followZoom and fixed the same", () => {
    const id = IDENTITY_CAMERA(layout);
    const p = { x: 0.25, y: 0.75 };
    expect(frameNormToCanvas(p, layout, id, true).x).toBeCloseTo(
      frameNormToCanvas(p, layout, id, false).x,
    );
  });
});
