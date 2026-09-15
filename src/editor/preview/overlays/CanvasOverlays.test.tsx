import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAnnotation } from "../../inspector/annotations/annotations";
import { DEFAULT_FRAME_SETTINGS } from "../../inspector/frame/types";
import { bubbleRect } from "../../inspector/webcam/logic";
import { DEFAULT_WEBCAM_SETTINGS } from "../../inspector/webcam/types";
import type { ZoomRegion } from "../../inspector/zoom/types";
import { cameraTransform } from "../camera";
import { computeFrameLayout } from "../layout";
import { CanvasOverlays, reticleRect } from "./CanvasOverlays";
import { IDENTITY_CAMERA } from "./coords";
import { drag, pointer } from "./testPointer";

const layout = computeFrameLayout(
  { width: 1600, height: 900 },
  structuredClone(DEFAULT_FRAME_SETTINGS),
  { width: 1920, height: 1080 },
);
const cam = IDENTITY_CAMERA(layout);

const zoom: ZoomRegion = {
  id: "z",
  startMs: 0,
  endMs: 2000,
  level: 2,
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
  easeInMs: 200,
  easeOutMs: 200,
  curve: "ease-out-cubic",
  source: "manual",
};

describe("zoom reticle (state 3)", () => {
  it("draws the zoomed viewport and drags the focus", () => {
    const onChange = vi.fn();
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        zoomRegion={zoom}
        onZoomFocusChange={onChange}
      />,
    );
    const el = screen.getByTestId("zoom-reticle");
    const r = reticleRect(layout, 2, zoom.focus);
    expect(el.style.width).toBe(`${r.width}px`);
    expect(r.width).toBeCloseTo(layout.content.width / 2);
    drag(el, 0, 0, layout.content.width * 0.1, 0);
    expect(onChange).toHaveBeenNthCalledWith(1, { x: expect.closeTo(0.6, 6), y: 0.5 }, false);
    expect(onChange).toHaveBeenLastCalledWith({ x: expect.closeTo(0.6, 6), y: 0.5 }, true);
  });

  it("clamps focus to 0..1 and starts from the clamped center", () => {
    const onChange = vi.fn();
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        zoomRegion={{ ...zoom, focus: { mode: "fixed", x: 0, y: 0 } }}
        onZoomFocusChange={onChange}
      />,
    );
    drag(screen.getByTestId("zoom-reticle"), 0, 0, -5000, -5000);
    expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 0 }, true);
  });
});

describe("annotation gizmo (state 8)", () => {
  const a = {
    ...createAnnotation("rect", { id: "r", playheadMs: 0, timelineDurationMs: 5000 }),
    x: 0.2,
    y: 0.2,
    w: 0.2,
    h: 0.1,
    rotation: 0,
  };

  it("move / resize / rotate report frame-normalized boxes", () => {
    const onChange = vi.fn();
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        annotation={a}
        onAnnotationBoxChange={onChange}
      />,
    );
    const W = layout.frame.width;
    const H = layout.frame.height;

    drag(screen.getByTestId("annotation-gizmo"), 100, 100, 100 + W * 0.1, 100);
    expect(onChange.mock.lastCall?.[0].x).toBeCloseTo(0.3);
    expect(onChange.mock.lastCall?.[0].w).toBeCloseTo(0.2);
    expect(onChange.mock.lastCall?.[1]).toBe(true);

    drag(screen.getByTestId("gizmo-handle-se"), 0, 0, W * 0.05, H * 0.05);
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      x: expect.closeTo(0.2),
      w: expect.closeTo(0.25),
      h: expect.closeTo(0.15),
    });

    // Box center in canvas px; pointer straight to the right → 90°.
    const cx = layout.frame.x + (0.2 + 0.1) * W;
    const cy = layout.frame.y + (0.2 + 0.05) * H;
    drag(screen.getByTestId("gizmo-rotate"), cx, cy - 50, cx + 200, cy);
    expect(onChange.mock.lastCall?.[0].rotation).toBeCloseTo(90);
  });

  it("followZoom items map through the camera", () => {
    const zoomed = cameraTransform({
      level: 2,
      focus: { x: 0.5, y: 0.5 },
      contentW: layout.content.width,
      contentH: layout.content.height,
    });
    const onChange = vi.fn();
    render(
      <CanvasOverlays
        layout={layout}
        camera={zoomed}
        annotation={{ ...a, followZoom: true }}
        onAnnotationBoxChange={onChange}
      />,
    );
    const el = screen.getByTestId("annotation-gizmo");
    expect(Number.parseFloat(el.style.width)).toBeCloseTo(0.2 * layout.frame.width * 2);
    drag(el, 0, 0, layout.frame.width * 0.2, 0);
    // 2× zoom: a 0.2-frame drag on canvas is 0.1 in frame units.
    expect(onChange.mock.lastCall?.[0].x).toBeCloseTo(0.3);
  });
});

describe("crop mode (state 9)", () => {
  it("resizes with a handle and commits on Done; Reset → null", () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(
      <CanvasOverlays layout={layout} camera={cam} crop={{ value: null, onDone, onCancel }} />,
    );
    drag(screen.getByTestId("crop-handle-e"), 0, 0, -layout.content.width * 0.25, 0);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone.mock.lastCall?.[0]).toMatchObject({
      x: 0,
      y: 0,
      width: expect.closeTo(0.75),
      height: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("aspect lock keeps the ratio while dragging a side", () => {
    const onDone = vi.fn();
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        crop={{ value: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, onDone }}
      />,
    );
    const lock = screen.getByRole("button", { name: "Lock aspect" });
    fireEvent.click(lock);
    expect(lock).toHaveAttribute("aria-pressed", "true");
    drag(screen.getByTestId("crop-handle-e"), 0, 0, layout.content.width * 0.1, 0);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const c = onDone.mock.lastCall?.[0];
    expect(c.width / c.height).toBeCloseTo(1);
    expect(c.width).toBeCloseTo(0.5);
  });

  it("crop mode hides the other overlays", () => {
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        zoomRegion={zoom}
        onZoomFocusChange={() => {}}
        crop={{ value: null, onDone: () => {} }}
      />,
    );
    expect(screen.queryByTestId("zoom-reticle")).not.toBeInTheDocument();
  });
});

describe("webcam drag (state 10)", () => {
  it("shows grid + guides while dragging and snaps to an anchor", () => {
    const onMove = vi.fn();
    const settings = { ...DEFAULT_WEBCAM_SETTINGS, anchor: "bottom-left" as const };
    const frame = { width: layout.frame.width, height: layout.frame.height };
    const margin = settings.marginPx * layout.scale;
    const base = bubbleRect(frame, { ...settings, marginPx: margin });
    const topRight = bubbleRect(frame, { ...settings, anchor: "top-right", marginPx: margin });
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        webcam={{ settings, rect: { x: base.x, y: base.y, width: base.w, height: base.h } }}
        onWebcamMove={onMove}
      />,
    );
    const el = screen.getByTestId("webcam-drag");
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", topRight.x - base.x + 3, topRight.y - base.y - 2);
    expect(screen.getByTestId("webcam-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("webcam-guide")).toHaveLength(2);
    pointer(el, "pointerup", 0, 0);
    expect(onMove).toHaveBeenLastCalledWith(
      { anchor: "top-right", customX: expect.any(Number), customY: expect.any(Number) },
      true,
    );
    expect(screen.queryByTestId("webcam-grid")).not.toBeInTheDocument();
  });

  it("free position stores a custom center", () => {
    const onMove = vi.fn();
    const settings = DEFAULT_WEBCAM_SETTINGS;
    const frame = { width: layout.frame.width, height: layout.frame.height };
    const base = bubbleRect(frame, { ...settings, marginPx: settings.marginPx * layout.scale });
    render(
      <CanvasOverlays
        layout={layout}
        camera={cam}
        webcam={{ settings, rect: { x: base.x, y: base.y, width: base.w, height: base.h } }}
        onWebcamMove={onMove}
      />,
    );
    const dx = frame.width * 0.3;
    const dy = -frame.height * 0.3;
    drag(screen.getByTestId("webcam-drag"), 0, 0, dx, dy);
    const [pos, commit] = onMove.mock.lastCall ?? [];
    expect(commit).toBe(true);
    expect(pos.anchor).toBeNull();
    expect(pos.customX).toBeCloseTo((base.x + dx + base.w / 2) / frame.width);
  });
});
