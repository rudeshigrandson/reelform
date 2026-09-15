import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectSession } from "../../app/project/session";
import { createAnnotation } from "../inspector/annotations/annotations";
import { usePlaybackStore } from "../playback";
import { useEditorStore } from "../store";
import { EditorPreview } from "./EditorPreview";
import { drag } from "./overlays/testPointer";
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

const noWallpapers = async (): Promise<unknown> => [];

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
  useEditorStore.getState().reset();
  usePlaybackStore.getState().reset();
  useProjectSession.getState().reset();
  useProjectSession
    .getState()
    .setSession({ videoUrl: "file:///rec.mp4", sourceSize: { width: 1920, height: 1080 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const zoom = {
  id: "z",
  startMs: 0,
  endMs: 2000,
  level: 2,
  focus: { mode: "follow" as const, x: 0.5, y: 0.5 },
  easeInMs: 0,
  easeOutMs: 0,
  curve: "linear" as const,
  source: "manual" as const,
};

describe("EditorPreview", () => {
  it("feeds document layers into the composed scene", async () => {
    const { stage, create } = fakeStage();
    const a = createAnnotation("text", { id: "t", playheadMs: 0, timelineDurationMs: 5000 });
    useEditorStore.getState().update({ annotations: [a] });
    render(<EditorPreview createStage={create} fetchJson={noWallpapers} />);
    await waitFor(() => expect(stage.render).toHaveBeenCalled());
    const comp = stage.render.mock.lastCall?.[0].composition;
    expect(
      [...(comp?.annotations.frame ?? []), ...(comp?.annotations.content ?? [])].map((i) => i.id),
    ).toEqual(["t"]);
  });

  it("zoom reticle drag writes the focus through the injected update", async () => {
    const { create } = fakeStage();
    useEditorStore.getState().update({ zoomRegions: [zoom], selectedZoomId: "z" });
    const update = vi.fn();
    const onZoomFocusChange = vi.fn();
    render(
      <EditorPreview
        createStage={create}
        fetchJson={noWallpapers}
        update={update}
        onZoomFocusChange={onZoomFocusChange}
      />,
    );
    const reticle = await screen.findByTestId("zoom-reticle");
    drag(reticle, 0, 0, -50, 0);
    const patch = update.mock.lastCall?.[0];
    expect(patch.zoomRegions[0].focus).toMatchObject({ mode: "fixed", y: expect.closeTo(0.5, 6) });
    expect(patch.zoomRegions[0].focus.x).toBeLessThan(0.5);
    expect(onZoomFocusChange).toHaveBeenLastCalledWith("z", expect.any(Object), true);
    // Injected writer: the store itself is untouched.
    expect(useEditorStore.getState().zoomRegions[0]?.focus.mode).toBe("follow");
  });

  it("annotation gizmo writes the store by default", async () => {
    const { create } = fakeStage();
    const a = {
      ...createAnnotation("rect", { id: "r", playheadMs: 0, timelineDurationMs: 5000 }),
      x: 0.2,
      y: 0.2,
    };
    useEditorStore.getState().update({ annotations: [a], selectedAnnotationId: "r" });
    render(<EditorPreview createStage={create} fetchJson={noWallpapers} />);
    const gizmo = await screen.findByTestId("annotation-gizmo");
    drag(gizmo, 0, 0, 64, 0);
    const moved = useEditorStore.getState().annotations[0];
    expect(moved?.id).toBe("r");
    expect(moved?.x).toBeGreaterThan(0.2);
    expect(moved?.y).toBeCloseTo(0.2, 6);
  });

  it("crop: canvas button → Done writes frame.crop and exits crop mode", async () => {
    const { create } = fakeStage();
    useEditorStore.getState().update({
      frame: {
        ...useEditorStore.getState().frame,
        crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      },
    });
    render(<EditorPreview createStage={create} fetchJson={noWallpapers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Crop" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(useEditorStore.getState().frame.crop).toBeNull();
    expect(screen.queryByTestId("crop-rect")).not.toBeInTheDocument();
  });

  it("webcam bubble drag writes the webcam position", async () => {
    const { create } = fakeStage();
    useProjectSession.getState().setSession({ webcamUrl: "file:///cam.mp4" });
    const update = vi.fn();
    render(<EditorPreview createStage={create} fetchJson={noWallpapers} update={update} />);
    const bubble = await screen.findByTestId("webcam-drag");
    drag(bubble, 0, 0, 0, 0);
    expect(update.mock.lastCall?.[0].webcam).toMatchObject({ anchor: expect.anything() });
  });

  it("uses the wallpaper manifest when it loads", async () => {
    const { stage, create } = fakeStage();
    const fetchJson = vi.fn(async () => ({
      wallpapers: [{ id: "abstract-1", kind: "radial", stops: ["#000000", "#ffffff"] }],
    }));
    render(<EditorPreview createStage={create} fetchJson={fetchJson} />);
    await waitFor(() =>
      expect(stage.render.mock.lastCall?.[0].background.paint.kind).toBe("radial-gradient"),
    );
    expect(fetchJson).toHaveBeenCalledWith("/wallpapers/wallpapers.json");
  });

  it("Auto/Half play the proxy when it exists; Full plays the original", async () => {
    const { create } = fakeStage();
    useProjectSession.getState().setSession({ proxyUrl: "file:///proxy.mp4" });
    const src = () => document.querySelector("video")?.getAttribute("src");
    const { rerender } = render(
      <EditorPreview createStage={create} fetchJson={noWallpapers} quality="half" />,
    );
    await waitFor(() => expect(src()).toBe("file:///proxy.mp4"));
    rerender(<EditorPreview createStage={create} fetchJson={noWallpapers} quality="auto" />);
    expect(src()).toBe("file:///proxy.mp4");
    rerender(<EditorPreview createStage={create} fetchJson={noWallpapers} quality="full" />);
    await waitFor(() => expect(src()).toBe("file:///rec.mp4"));
  });

  it("canvas edits name their gesture for history", async () => {
    const { create } = fakeStage();
    useEditorStore.getState().update({ zoomRegions: [zoom], selectedZoomId: "z" });
    const update = vi.fn();
    render(<EditorPreview createStage={create} fetchJson={noWallpapers} update={update} />);
    drag(await screen.findByTestId("zoom-reticle"), 0, 0, -50, 0);
    expect(update.mock.calls.at(-2)?.[1]).toEqual({
      label: "Move zoom focus",
      coalesceKey: "canvas:zoomFocus:z",
      commit: false,
    });
    expect(update.mock.lastCall?.[1]).toMatchObject({
      coalesceKey: "canvas:zoomFocus:z",
      commit: true,
    });
  });

  it("media offline shows Locate…", async () => {
    const { create } = fakeStage();
    useProjectSession.getState().setSession({ mediaOffline: true });
    const onLocateMedia = vi.fn();
    render(
      <EditorPreview createStage={create} fetchJson={noWallpapers} onLocateMedia={onLocateMedia} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Locate…" }));
    expect(onLocateMedia).toHaveBeenCalled();
  });
});
