import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURSOR_SETTINGS } from "../inspector/cursor/types";
import { DEFAULT_EFFECTS_SETTINGS } from "../inspector/effects/types";
import { DEFAULT_FRAME_SETTINGS } from "../inspector/frame/types";
import { PreviewCanvas, type PreviewCanvasProps } from "./PreviewCanvas";
import type { CreatePreviewStage, PreviewStage } from "./pixiStage";
import type { SceneState } from "./scene";

function fakeStage() {
  const stage = {
    setVideo: vi.fn<(el: HTMLVideoElement | null) => void>(),
    render: vi.fn<(s: SceneState) => void>(),
    resize: vi.fn<(w: number, h: number) => void>(),
    destroy: vi.fn<() => void>(),
  } satisfies PreviewStage;
  const create = vi.fn<CreatePreviewStage>(() => Promise.resolve(stage));
  return { stage, create };
}

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

const root = () => screen.getByTestId("preview-canvas");
const video = () => screen.getByTestId("preview-video") as HTMLVideoElement;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreviewCanvas", () => {
  it("shows loading, then ready with a rendered frame", async () => {
    let resolve: (s: PreviewStage) => void = () => {};
    const { stage } = fakeStage();
    const create = vi.fn<CreatePreviewStage>(
      () =>
        new Promise<PreviewStage>((r) => {
          resolve = r;
        }),
    );
    render(<PreviewCanvas {...baseProps(create)} />);
    expect(root()).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("Starting preview…")).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => resolve(stage));
    expect(root()).toHaveAttribute("data-state", "ready");
    expect(screen.queryByText("Starting preview…")).not.toBeInTheDocument();
    expect(stage.render).toHaveBeenCalled();
    expect(stage.setVideo).toHaveBeenLastCalledWith(video());
    const state = stage.render.mock.lastCall?.[0];
    expect(state?.tMs).toBe(0);
    expect(state?.video.visible).toBe(true);
  });

  it("mounts a second video for cross-dissolve and parks it on the incoming frame", async () => {
    const { stage, create } = fakeStage();
    const setNextVideo = vi.fn<(el: HTMLVideoElement | null) => void>();
    const withNext = { ...stage, setNextVideo };
    const createNext = vi.fn<CreatePreviewStage>(() => Promise.resolve(withNext));
    const clips = [
      { id: "a", sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: 0 },
      { id: "b", sourceStartMs: 5000, sourceEndMs: 8000, timelineStartMs: 2000 },
    ];
    const effects = structuredClone(DEFAULT_EFFECTS_SETTINGS);
    effects.transition = { kind: "cross-dissolve", durationMs: 400 };
    const props = { ...baseProps(createNext), clips, effects, currentMs: 1800 };
    const { rerender } = render(<PreviewCanvas {...props} />);
    await act(async () => {});
    const next = screen.getByTestId("preview-next-video") as HTMLVideoElement;
    expect(setNextVideo).toHaveBeenLastCalledWith(next);
    expect(next.currentTime).toBeCloseTo(5, 6);
    expect(stage.render.mock.lastCall?.[0].transition?.kind).toBe("cross-dissolve");

    rerender(<PreviewCanvas {...props} effects={DEFAULT_EFFECTS_SETTINGS} />);
    await act(async () => {});
    expect(screen.queryByTestId("preview-next-video")).toBeNull();
    expect(setNextVideo).toHaveBeenLastCalledWith(null);
    expect(create).not.toHaveBeenCalled();
  });

  it("shows the error state when the stage fails to start", async () => {
    const create = vi.fn<CreatePreviewStage>(() => Promise.reject(new Error("WebGL context lost")));
    render(<PreviewCanvas {...baseProps(create)} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Preview unavailable — GPU renderer failed to start");
    expect(alert).toHaveTextContent("WebGL context lost");
    expect(root()).toHaveAttribute("data-state", "error");
  });

  it("media offline shows Locate… calling the handler and detaches video", async () => {
    const { stage, create } = fakeStage();
    const onLocateMedia = vi.fn();
    render(<PreviewCanvas {...baseProps(create)} mediaOffline onLocateMedia={onLocateMedia} />);
    await waitFor(() => expect(root()).toHaveAttribute("data-state", "offline"));
    expect(screen.getByText("Media offline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Locate…" }));
    expect(onLocateMedia).toHaveBeenCalledTimes(1);
    expect(stage.setVideo).toHaveBeenLastCalledWith(null);
    expect(video()).not.toHaveAttribute("src");
  });

  it("empty state: frame still renders with a No media label", async () => {
    const { stage, create } = fakeStage();
    render(<PreviewCanvas {...baseProps(create)} videoUrl={null} />);
    await waitFor(() => expect(root()).toHaveAttribute("data-state", "empty"));
    expect(screen.getByText("No media")).toBeInTheDocument();
    expect(stage.render).toHaveBeenCalled();
    expect(stage.render.mock.lastCall?.[0].video.visible).toBe(false);
    expect(stage.setVideo).toHaveBeenLastCalledWith(null);
  });

  it("re-renders on currentMs change and seeks the paused video beyond one frame of drift", async () => {
    const { stage, create } = fakeStage();
    const props = baseProps(create);
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    const calls = stage.render.mock.calls.length;

    rerender(<PreviewCanvas {...props} currentMs={2500} />);
    expect(stage.render.mock.calls.length).toBeGreaterThan(calls);
    expect(stage.render.mock.lastCall?.[0].tMs).toBe(2500);
    expect(video().currentTime).toBeCloseTo(2.5, 6);

    // Sub-frame drift does not seek.
    rerender(<PreviewCanvas {...props} currentMs={2505} />);
    expect(video().currentTime).toBeCloseTo(2.5, 6);
  });

  it("plays and pauses the hidden video with isPlaying", async () => {
    const { stage, create } = fakeStage();
    const props = baseProps(create);
    const { rerender } = render(<PreviewCanvas {...props} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);

    rerender(<PreviewCanvas {...props} isPlaying currentMs={10} />);
    expect(play).toHaveBeenCalledTimes(1);

    Object.defineProperty(video(), "paused", { configurable: true, get: () => false });
    rerender(<PreviewCanvas {...props} isPlaying={false} currentMs={20} />);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("shows the aspect chip", async () => {
    const { create } = fakeStage();
    const frame = structuredClone(DEFAULT_FRAME_SETTINGS);
    frame.aspect = { preset: "custom", customWidth: 1200, customHeight: 628 };
    render(<PreviewCanvas {...baseProps(create)} frame={frame} />);
    expect(screen.getByTestId("aspect-chip")).toHaveTextContent("1200×628");
    await waitFor(() => expect(root()).toHaveAttribute("data-state", "ready"));
  });

  it("destroys the stage on unmount", async () => {
    const { stage, create } = fakeStage();
    const { unmount } = render(<PreviewCanvas {...baseProps(create)} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    unmount();
    expect(stage.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a stage that resolves after unmount", async () => {
    let resolve: (s: PreviewStage) => void = () => {};
    const { stage } = fakeStage();
    const create = vi.fn<CreatePreviewStage>(
      () =>
        new Promise<PreviewStage>((r) => {
          resolve = r;
        }),
    );
    const { unmount } = render(<PreviewCanvas {...baseProps(create)} />);
    unmount();
    await act(async () => resolve(stage));
    expect(stage.destroy).toHaveBeenCalledTimes(1);
    expect(stage.render).not.toHaveBeenCalled();
  });
});
