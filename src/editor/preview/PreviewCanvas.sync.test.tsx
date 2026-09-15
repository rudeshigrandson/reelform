import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURSOR_SETTINGS } from "../inspector/cursor/types";
import { DEFAULT_FRAME_SETTINGS } from "../inspector/frame/types";
import { DEFAULT_WEBCAM_SETTINGS } from "../inspector/webcam/types";
import type { Clip } from "../model/schema";
import { PreviewCanvas, type PreviewCanvasProps } from "./PreviewCanvas";
import type { CreatePreviewStage, PreviewStage } from "./pixiStage";
import type { SceneState } from "./scene";
import { SCRUB_SETTLE_MS } from "./videoSync";

function fakeStage() {
  const stage = {
    setVideo: vi.fn<(el: HTMLVideoElement | null) => void>(),
    setWebcam: vi.fn<(el: HTMLVideoElement | null) => void>(),
    refreshVideo: vi.fn<() => void>(),
    setResolution: vi.fn<(r: number) => void>(),
    render: vi.fn<(s: SceneState) => void>(),
    resize: vi.fn<(w: number, h: number) => void>(),
    destroy: vi.fn<() => void>(),
  } satisfies PreviewStage;
  const create = vi.fn<CreatePreviewStage>(() => Promise.resolve(stage));
  return { stage, create };
}

const clips: Clip[] = [
  { id: "a", sourceStartMs: 1000, sourceEndMs: 3000, timelineStartMs: 0 },
  { id: "b", sourceStartMs: 6000, sourceEndMs: 9000, timelineStartMs: 2000 },
];

const baseProps = (create: CreatePreviewStage): PreviewCanvasProps => ({
  frame: DEFAULT_FRAME_SETTINGS,
  zoomRegions: [],
  cursor: DEFAULT_CURSOR_SETTINGS,
  cursorTrack: null,
  currentMs: 0,
  isPlaying: false,
  videoUrl: "file:///rec.mp4",
  sourceSize: { width: 1920, height: 1080 },
  createStage: create,
});

const video = () => screen.getByTestId("preview-video") as HTMLVideoElement;
const root = () => screen.getByTestId("preview-canvas");

// jsdom has no layout: give the preview well a real size so overlays map pointer deltas.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 720,
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PreviewCanvas media sync", () => {
  it("maps the playhead through clips and hides the video in a gap", async () => {
    const { stage, create } = fakeStage();
    const props = { ...baseProps(create), clips };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    rerender(<PreviewCanvas {...props} currentMs={2500} />);
    expect(video().currentTime).toBeCloseTo(6.5, 6);
    rerender(<PreviewCanvas {...props} currentMs={9000} />);
    await waitFor(() => expect(stage.render.mock.lastCall?.[0].video.visible).toBe(false));
  });

  it("sets playbackRate from speed regions while playing", async () => {
    const { stage, create } = fakeStage();
    const props = {
      ...baseProps(create),
      speedRegions: [{ startMs: 0, endMs: 5000, rate: 2, keepPitch: true }],
    };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    rerender(<PreviewCanvas {...props} isPlaying currentMs={100} />);
    expect(video().playbackRate).toBe(2);
    rerender(<PreviewCanvas {...props} isPlaying currentMs={100} shuttleRate={8} />);
    expect(video().playbackRate).toBe(8);
  });

  it("uses fastSeek while scrubbing and settles with a precise seek", async () => {
    const { stage, create } = fakeStage();
    let t = 0;
    const props = { ...baseProps(create), now: () => t };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    const fastSeek = vi.fn();
    Object.defineProperty(video(), "fastSeek", { configurable: true, value: fastSeek });

    vi.useFakeTimers();
    t = 1000;
    rerender(<PreviewCanvas {...props} currentMs={1000} />);
    expect(fastSeek).not.toHaveBeenCalled(); // first seek: precise
    expect(video().currentTime).toBeCloseTo(1);
    t = 1050;
    rerender(<PreviewCanvas {...props} currentMs={1500} />);
    expect(fastSeek).toHaveBeenCalledWith(1.5);
    // fastSeek landed on a keyframe; the settle seek fixes the exact frame.
    act(() => {
      vi.advanceTimersByTime(SCRUB_SETTLE_MS + 1);
    });
    expect(video().currentTime).toBeCloseTo(1.5);

    fastSeek.mockClear();
    rerender(<PreviewCanvas {...props} currentMs={2000} scrubbing={false} />);
    expect(fastSeek).not.toHaveBeenCalled();
    rerender(<PreviewCanvas {...props} currentMs={2500} scrubbing />);
    expect(fastSeek).toHaveBeenCalledWith(2.5);
  });

  it("a pending scrub settle never pauses playback that started before it fired", async () => {
    const { stage, create } = fakeStage();
    let t = 0;
    const props = { ...baseProps(create), now: () => t };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    Object.defineProperty(video(), "fastSeek", { configurable: true, value: vi.fn() });
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);

    vi.useFakeTimers();
    t = 1000;
    rerender(<PreviewCanvas {...props} currentMs={1000} />);
    t = 1050;
    rerender(<PreviewCanvas {...props} currentMs={1500} />); // fast seek → settle armed
    t = 1100;
    rerender(<PreviewCanvas {...props} currentMs={1500} isPlaying />);
    pause.mockClear();
    act(() => {
      vi.advanceTimersByTime(SCRUB_SETTLE_MS * 2);
    });
    expect(pause).not.toHaveBeenCalled();
  });

  it("the scrub settle also lands the webcam on its exact (offset) frame", async () => {
    const { stage, create } = fakeStage();
    let t = 0;
    const props = {
      ...baseProps(create),
      now: () => t,
      webcamUrl: "file:///cam.mp4",
      webcam: { ...DEFAULT_WEBCAM_SETTINGS, syncOffsetMs: 250 },
    };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    const cam = screen.getByTestId("preview-webcam-video") as HTMLVideoElement;
    const camFast = vi.fn();
    Object.defineProperty(video(), "fastSeek", { configurable: true, value: vi.fn() });
    Object.defineProperty(cam, "fastSeek", { configurable: true, value: camFast });

    vi.useFakeTimers();
    t = 1000;
    rerender(<PreviewCanvas {...props} currentMs={1000} />);
    t = 1050;
    rerender(<PreviewCanvas {...props} currentMs={2000} />);
    expect(camFast).toHaveBeenCalledWith(2.25);
    expect(cam.currentTime).toBeCloseTo(1.25); // fastSeek is a no-op fake
    act(() => {
      vi.advanceTimersByTime(SCRUB_SETTLE_MS + 1);
    });
    expect(cam.currentTime).toBeCloseTo(2.25);
  });

  it("refreshes the stage on presented video frames (requestVideoFrameCallback)", async () => {
    const cbs: Array<() => void> = [];
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: (cb: () => void) => cbs.push(cb),
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value: () => {},
    });
    try {
      const { stage, create } = fakeStage();
      render(<PreviewCanvas {...baseProps(create)} />);
      await waitFor(() => expect(cbs.length).toBeGreaterThan(0));
      act(() => cbs[0]?.());
      expect(stage.refreshVideo).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback");
      Reflect.deleteProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
    }
  });

  it("attaches and syncs the webcam video with its offset", async () => {
    const { stage, create } = fakeStage();
    const props = {
      ...baseProps(create),
      webcamUrl: "file:///cam.mp4",
      webcam: { ...DEFAULT_WEBCAM_SETTINGS, syncOffsetMs: 250 },
    };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() =>
      expect(stage.setWebcam).toHaveBeenLastCalledWith(screen.getByTestId("preview-webcam-video")),
    );
    rerender(<PreviewCanvas {...props} currentMs={1000} />);
    expect(
      (screen.getByTestId("preview-webcam-video") as HTMLVideoElement).currentTime,
    ).toBeCloseTo(1.25);
    expect(stage.render.mock.lastCall?.[0].composition?.webcam.visible).toBe(true);
  });
});

describe("PreviewCanvas view controls", () => {
  it("canvas zoom 100% renders at the output size", async () => {
    const { stage, create } = fakeStage();
    render(<PreviewCanvas {...baseProps(create)} />);
    await waitFor(() => expect(root()).toHaveAttribute("data-state", "ready"));
    fireEvent.click(screen.getByRole("radio", { name: "100%" }));
    expect(root()).toHaveAttribute("data-zoom", "100");
    expect(stage.resize).toHaveBeenLastCalledWith(1920, 1080);
    expect(stage.render.mock.lastCall?.[0].layout.canvas).toEqual({ width: 1920, height: 1080 });
  });

  it("preview quality sets the stage resolution", async () => {
    const { stage, create } = fakeStage();
    const { rerender } = render(<PreviewCanvas {...baseProps(create)} quality="full" />);
    await waitFor(() => expect(stage.setResolution).toHaveBeenCalled());
    const full = stage.setResolution.mock.lastCall?.[0] ?? 0;
    rerender(<PreviewCanvas {...baseProps(create)} quality="half" />);
    expect(stage.setResolution.mock.lastCall?.[0]).toBeCloseTo(Math.max(0.25, full / 2));
  });

  it("crop button enters crop mode; overlays hide while playing", async () => {
    const { stage, create } = fakeStage();
    const onCropModeChange = vi.fn();
    const zoom = {
      id: "z",
      startMs: 0,
      endMs: 1000,
      level: 2,
      focus: { mode: "fixed" as const, x: 0.5, y: 0.5 },
      easeInMs: 0,
      easeOutMs: 0,
      curve: "linear" as const,
      source: "manual" as const,
    };
    const props = {
      ...baseProps(create),
      zoomRegions: [zoom],
      selectedZoomId: "z",
      onZoomFocusChange: vi.fn(),
      onCropModeChange,
    };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(screen.getByTestId("zoom-reticle")).toBeInTheDocument());
    // Selected zoom while paused: camera suppressed so the reticle lines up.
    expect(stage.render.mock.lastCall?.[0].camera.scale).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    expect(onCropModeChange).toHaveBeenCalledWith(true);

    rerender(<PreviewCanvas {...props} isPlaying currentMs={500} />);
    expect(screen.queryByTestId("zoom-reticle")).not.toBeInTheDocument();
    expect(stage.render.mock.lastCall?.[0].camera.scale).toBe(2);
  });

  it("crop mode renders the uncropped source and commits on Done", async () => {
    const { stage, create } = fakeStage();
    const onCropCommit = vi.fn();
    const onCropModeChange = vi.fn();
    const frame = {
      ...structuredClone(DEFAULT_FRAME_SETTINGS),
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    };
    render(
      <PreviewCanvas
        {...baseProps(create)}
        frame={frame}
        cropMode
        onCropCommit={onCropCommit}
        onCropModeChange={onCropModeChange}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("crop-rect")).toBeInTheDocument());
    expect(stage.render.mock.lastCall?.[0].video.crop).toBeNull();
    expect(screen.queryByTestId("canvas-zoom")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCropCommit).toHaveBeenCalledWith({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(onCropModeChange).toHaveBeenCalledWith(false);
  });
});
