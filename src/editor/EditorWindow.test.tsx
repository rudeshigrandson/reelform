import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectSession } from "../app/project/session";
import { useAppSettings } from "../app/settings/store";
import { sampleSettings } from "../settings/types";
import { ShortcutsProvider } from "../shortcuts/ShortcutsProvider";
import { EditorWindow } from "./EditorWindow";
import { usePlaybackStore } from "./playback";
import type { CreatePreviewStage, PreviewStage, SceneState } from "./preview";
import { drag } from "./preview/overlays/testPointer";
import { createEditorHistory } from "./state";
import { useEditorStore, useEditorUiStore } from "./store";

function fakeStageFactory() {
  const renders: SceneState[] = [];
  const stage: PreviewStage = {
    setVideo: vi.fn(),
    render: vi.fn((s: SceneState) => {
      renders.push(s);
    }),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
  const createStage: CreatePreviewStage = vi.fn(async () => stage);
  return { createStage, stage, renders };
}

beforeEach(() => {
  useEditorStore.getState().reset();
  usePlaybackStore.getState().reset();
  useProjectSession.getState().reset();
  useEditorUiStore.getState().clearPendingSuggestions();
  useAppSettings.setState({ settings: sampleSettings });
});

afterEach(() => {
  useAppSettings.setState({ settings: sampleSettings });
});

/** jsdom has no layout: a 1000px rect everywhere so the timeline renders its items. */
function withLayout(run: () => void): void {
  const rect = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 200 }));
  try {
    run();
  } finally {
    rect.mockRestore();
  }
}

const zoomRegion = (id: string, startMs: number, endMs: number, source: "auto" | "manual") => ({
  id,
  startMs,
  endMs,
  level: 2,
  focus: { mode: "follow" as const, x: 0.5, y: 0.5 },
  easeInMs: 0,
  easeOutMs: 0,
  curve: "linear" as const,
  source,
  ...(source === "auto" ? { reason: "dwell" } : {}),
});

function renderWindow(extra: Partial<Parameters<typeof EditorWindow>[0]> = {}, wrap = false) {
  const { createStage } = fakeStageFactory();
  const ui: ReactElement = (
    <EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} {...extra} />
  );
  return render(wrap ? <ShortcutsProvider platform="mac">{ui}</ShortcutsProvider> : ui);
}

describe("EditorWindow", () => {
  it("syncs the playback duration from the document and shows the transport", () => {
    const { createStage } = fakeStageFactory();
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    expect(usePlaybackStore.getState().durationMs).toBe(useEditorStore.getState().durationMs);
    expect(screen.getByRole("button", { name: "Play (Space)" })).toBeInTheDocument();
    expect(screen.getByText(/01:32\.000/)).toBeInTheDocument();
  });

  it("playback bar skip-to-end moves the shared playhead", () => {
    const { createStage } = fakeStageFactory();
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    fireEvent.click(screen.getByRole("button", { name: /skip to end/i }));
    expect(usePlaybackStore.getState().currentMs).toBe(92_000);
  });

  it("Space toggles playback through the shortcuts hook", () => {
    const { createStage } = fakeStageFactory();
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    act(() => {
      fireEvent.keyDown(window, { key: " ", code: "Space" });
    });
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
  });

  it("renders the preview through the injected stage and re-renders on seek", async () => {
    const { createStage, renders } = fakeStageFactory();
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    await waitFor(() => expect(createStage).toHaveBeenCalled());
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));

    const before = renders.length;
    act(() => {
      usePlaybackStore.getState().seek(10_000);
    });
    await waitFor(() => expect(renders.length).toBeGreaterThan(before));
  });

  it("timeline shows document regions on their tracks", () => {
    useEditorStore.getState().update({
      speedRegions: [
        {
          id: "s1",
          startMs: 1000,
          endMs: 3000,
          rate: 2,
          keepPitch: true,
          rampInMs: 0,
          rampOutMs: 0,
        },
      ],
    });
    // jsdom has no layout; give the timeline a viewport so virtualisation renders items.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 200 }));
    try {
      const { createStage } = fakeStageFactory();
      render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
      expect(screen.getByRole("button", { name: /^Speed 2×/ })).toBeInTheDocument();
    } finally {
      rect.mockRestore();
    }
  });

  it("'+' on the Zoom track adds a selected zoom at the playhead; Delete in the bar removes it", () => {
    const { createStage } = fakeStageFactory();
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    act(() => {
      usePlaybackStore.getState().seek(4000);
    });

    const deleteBtn = screen.getByRole("button", { name: /delete selection/i });
    expect(deleteBtn).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));
    const [added] = useEditorStore.getState().zoomRegions;
    expect(added).toMatchObject({ startMs: 4000, endMs: 6000, source: "manual" });
    expect(useEditorStore.getState().selectedZoomId).toBe(added?.id);
    expect(screen.getByRole("button", { name: /delete selection/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /delete selection/i }));
    expect(useEditorStore.getState().zoomRegions).toEqual([]);
    expect(useEditorStore.getState().selectedZoomId).toBeNull();
  });

  it("the Delete key removes the timeline selection, but not while typing", () => {
    const { createStage } = fakeStageFactory();
    render(
      <>
        <input aria-label="scratch" />
        <EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Speed at playhead" }));
    expect(useEditorStore.getState().speedRegions).toHaveLength(1);

    fireEvent.keyDown(screen.getByLabelText("scratch"), { key: "Delete" });
    expect(useEditorStore.getState().speedRegions).toHaveLength(1);

    act(() => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    expect(useEditorStore.getState().speedRegions).toEqual([]);
  });

  it("'+' refuses to stack a zoom on an existing one", () => {
    const { createStage } = fakeStageFactory();
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    const add = screen.getByRole("button", { name: "Add Zoom at playhead" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(useEditorStore.getState().zoomRegions).toHaveLength(1);
  });

  it("zoom regions from the document drive the preview camera", async () => {
    const { createStage, renders } = fakeStageFactory();
    useEditorStore.getState().update({
      zoomRegions: [
        {
          id: "z1",
          startMs: 0,
          endMs: 4000,
          level: 2,
          focus: { mode: "fixed", x: 0.5, y: 0.5 },
          easeInMs: 500,
          easeOutMs: 500,
          curve: "linear",
          source: "manual",
        },
      ],
    });
    render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
    act(() => {
      usePlaybackStore.getState().seek(2000);
    });
    await waitFor(() => {
      const last = renders[renders.length - 1];
      expect(last?.camera.scale).toBeCloseTo(2);
    });
  });

  describe("history + clip operations", () => {
    it("S splits the clip at the playhead; ⌘Z undoes it and the tooltip names it", () => {
      const { createStage } = fakeStageFactory();
      render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
      expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
      act(() => {
        usePlaybackStore.getState().seek(30_000);
      });
      act(() => {
        fireEvent.keyDown(window, { key: "s", code: "KeyS" });
      });
      expect(useEditorStore.getState().clips).toHaveLength(2);
      const undo = screen.getByRole("button", { name: "Undo" });
      expect(undo).toBeEnabled();
      expect(undo).toHaveAttribute("title", "Undo: Split clip");

      act(() => {
        fireEvent.keyDown(window, { key: "z", code: "KeyZ", metaKey: true });
      });
      expect(useEditorStore.getState().clips).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Redo" })).toHaveAttribute(
        "title",
        "Redo: Split clip",
      );
      act(() => {
        fireEvent.keyDown(window, { key: "z", code: "KeyZ", metaKey: true, shiftKey: true });
      });
      expect(useEditorStore.getState().clips).toHaveLength(2);
    });

    it("the playback bar split button uses the same command", () => {
      const { createStage } = fakeStageFactory();
      render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
      act(() => {
        usePlaybackStore.getState().seek(10_000);
      });
      fireEvent.click(screen.getByRole("button", { name: /split/i }));
      expect(useEditorStore.getState().clips.map((c) => c.timelineStartMs)).toEqual([0, 10_000]);
    });

    it("[ trims the clip start to the playhead, rippling duration and parking the playhead", () => {
      const { createStage } = fakeStageFactory();
      render(<EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />);
      act(() => {
        usePlaybackStore.getState().seek(12_000);
      });
      act(() => {
        fireEvent.keyDown(window, { key: "[", code: "BracketLeft" });
      });
      expect(useEditorStore.getState().durationMs).toBe(80_000);
      expect(useEditorStore.getState().clips[0]).toMatchObject({ sourceStartMs: 12_000 });
      expect(usePlaybackStore.getState().durationMs).toBe(80_000);
      expect(usePlaybackStore.getState().currentMs).toBe(0);
      act(() => {
        usePlaybackStore.getState().seek(40_000);
      });
      act(() => {
        fireEvent.keyDown(window, { key: "]", code: "BracketRight" });
      });
      expect(useEditorStore.getState().durationMs).toBe(40_000);
      expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute(
        "title",
        "Undo: Trim clip end",
      );
    });

    it("trim keys are ignored while typing", () => {
      const { createStage } = fakeStageFactory();
      render(
        <>
          <input aria-label="scratch" />
          <EditorWindow projectName="Demo" onExport={() => {}} createStage={createStage} />
        </>,
      );
      act(() => {
        usePlaybackStore.getState().seek(12_000);
      });
      fireEvent.keyDown(screen.getByLabelText("scratch"), { key: "[", code: "BracketLeft" });
      expect(useEditorStore.getState().durationMs).toBe(92_000);
    });

    it("adds go through an injected history (undo removes the zoom and its selection)", () => {
      const { createStage } = fakeStageFactory();
      const history = createEditorHistory({ now: () => 0 });
      render(
        <EditorWindow
          projectName="Demo"
          onExport={() => {}}
          createStage={createStage}
          history={history}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));
      expect(history.undoLabel()).toBe("Undo: Add zoom");
      act(() => {
        history.undo();
      });
      expect(useEditorStore.getState().zoomRegions).toEqual([]);
      expect(useEditorStore.getState().selectedZoomId).toBeNull();
      expect(screen.getByRole("button", { name: /delete selection/i })).toBeDisabled();
    });

    it("passes dirty and Back through to the shell", () => {
      const { createStage } = fakeStageFactory();
      const onBack = vi.fn();
      render(
        <EditorWindow
          projectName="Demo"
          onExport={() => {}}
          createStage={createStage}
          dirty
          onBack={onBack}
        />,
      );
      expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("canvas edits go through history", () => {
    it("a zoom focus drag is one undoable entry and marks the history dirty", async () => {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get: () => 1280,
      });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => 720,
      });
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
      try {
        useProjectSession
          .getState()
          .setSession({ videoUrl: "file:///rec.mp4", sourceSize: { width: 1920, height: 1080 } });
        useEditorStore.getState().update({
          zoomRegions: [zoomRegion("z", 0, 2000, "manual")],
          selectedZoomId: "z",
        });
        const history = createEditorHistory({ now: () => 0 });
        renderWindow({ history });
        const reticle = await screen.findByTestId("zoom-reticle");
        drag(reticle, 0, 0, -50, 0);

        const focus = useEditorStore.getState().zoomRegions[0]?.focus;
        expect(focus?.mode).toBe("fixed");
        expect(history.undoLabel()).toBe("Undo: Move zoom focus");
        expect(history.isDirty()).toBe(true);
        act(() => {
          history.undo();
        });
        expect(useEditorStore.getState().zoomRegions[0]?.focus).toEqual({
          mode: "follow",
          x: 0.5,
          y: 0.5,
        });
        expect(history.canUndo()).toBe(false);
      } finally {
        Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
        Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
        vi.restoreAllMocks();
      }
    });
  });

  describe("registry shortcuts (inside a ShortcutsProvider)", () => {
    const timeline = () => screen.getByTestId("timeline-ruler").closest("section") as HTMLElement;
    const key = (target: Element | Window, init: KeyboardEventInit) =>
      act(() => {
        fireEvent.keyDown(target, init);
      });

    it("→ in the timeline nudges the selection one frame; without one it steps a frame", () => {
      renderWindow({}, true);
      act(() => {
        usePlaybackStore.getState().seek(4000);
      });
      fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));
      const fps = usePlaybackStore.getState().fps;
      key(timeline(), { key: "ArrowRight", code: "ArrowRight" });
      expect(useEditorStore.getState().zoomRegions[0]?.startMs).toBeCloseTo(4000 + 1000 / fps);
      expect(usePlaybackStore.getState().currentMs).toBe(4000);

      key(timeline(), { key: "Escape", code: "Escape" });
      key(timeline(), { key: "ArrowRight", code: "ArrowRight" });
      expect(usePlaybackStore.getState().currentMs).toBeGreaterThan(4000);
    });

    it("⌘D duplicates, ⌘A selects the whole track, ⇧⌫ ripple-deletes", () => {
      withLayout(() => {
        renderWindow({}, true);
        fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));
        key(timeline(), { key: "d", code: "KeyD", metaKey: true });
        expect(useEditorStore.getState().zoomRegions).toHaveLength(2);
        expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute(
          "title",
          "Undo: Duplicate",
        );

        const lane = screen.getByRole("group", { name: "Zoom track" });
        key(lane, { key: "a", code: "KeyA", metaKey: true });
        expect(screen.getByRole("region", { name: "Selection summary" })).toHaveTextContent(
          "2 items",
        );

        key(timeline(), { key: "Backspace", code: "Backspace", shiftKey: true });
        expect(useEditorStore.getState().zoomRegions).toEqual([]);
      });
    });

    it("user overrides rebind undo; ⌘E exports", () => {
      const onExport = vi.fn();
      const { createStage } = fakeStageFactory();
      render(
        <ShortcutsProvider platform="mac" overrides={{ "editor.undo": "⌘U" }}>
          <EditorWindow projectName="Demo" onExport={onExport} createStage={createStage} />
        </ShortcutsProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Add Speed at playhead" }));
      key(window, { key: "z", code: "KeyZ", metaKey: true });
      expect(useEditorStore.getState().speedRegions).toHaveLength(1);
      key(window, { key: "u", code: "KeyU", metaKey: true });
      expect(useEditorStore.getState().speedRegions).toEqual([]);

      key(window, { key: "e", code: "KeyE", metaKey: true });
      expect(onExport).toHaveBeenCalledTimes(1);
    });

    it("[ trims through the registry when focus is in the timeline", () => {
      renderWindow({}, true);
      act(() => {
        usePlaybackStore.getState().seek(12_000);
      });
      key(timeline(), { key: "[", code: "BracketLeft" });
      expect(useEditorStore.getState().durationMs).toBe(80_000);
    });
  });

  describe("settings", () => {
    it("snap follows snapByDefault", () => {
      useAppSettings.setState({ settings: { ...sampleSettings, snapByDefault: false } });
      renderWindow();
      expect(screen.getByRole("button", { name: /snap/i })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("preview quality starts from previewQuality and plays the proxy for Auto/Half", async () => {
      useAppSettings.setState({ settings: { ...sampleSettings, previewQuality: "half" } });
      useProjectSession.getState().setSession({
        videoUrl: "file:///rec.mp4",
        proxyUrl: "file:///proxy.mp4",
        sourceSize: { width: 1920, height: 1080 },
      });
      renderWindow();
      expect(screen.getByRole("radio", { name: "Half" })).toBeChecked();
      await waitFor(() =>
        expect(document.querySelector("video")?.getAttribute("src")).toBe("file:///proxy.mp4"),
      );
      fireEvent.click(screen.getByRole("radio", { name: "Full" }));
      await waitFor(() =>
        expect(document.querySelector("video")?.getAttribute("src")).toBe("file:///rec.mp4"),
      );
    });

    it("selecting a caption switches to the Captions tab unless auto-switch is off", () => {
      useEditorStore.getState().update({
        captions: [{ id: "c1", startMs: 0, endMs: 900, text: "Hello there", words: [] }],
      });
      withLayout(() => {
        const { unmount } = renderWindow();
        fireEvent.keyDown(screen.getByRole("button", { name: /^Caption Hello there/ }), {
          key: "Enter",
        });
        expect(screen.getByRole("heading", { name: "Captions" })).toBeInTheDocument();
        unmount();

        useAppSettings.setState({ settings: { ...sampleSettings, inspectorAutoSwitch: false } });
        renderWindow();
        fireEvent.keyDown(screen.getByRole("button", { name: /^Caption Hello there/ }), {
          key: "Enter",
        });
        expect(screen.getByRole("heading", { name: "Frame" })).toBeInTheDocument();
      });
    });
  });

  describe("timeline media + suggestions", () => {
    it("draws filmstrip thumbnails inside the video clip", () => {
      useProjectSession.getState().setSession({
        thumbnails: [0, 2000, 4000].map((sourceMs) => ({ sourceMs, url: `thumb-${sourceMs}.jpg` })),
        waveformPeaks: Float32Array.from([0.2, 0.8, 0.4]),
        sourceSize: { width: 1920, height: 1080 },
      });
      withLayout(() => {
        renderWindow();
        expect(screen.getAllByTestId("filmstrip-thumb").length).toBeGreaterThan(0);
        expect(screen.getByTestId("clip-waveform")).toBeInTheDocument();
      });
    });

    it("only pending suggestions draw as ghosts", () => {
      useEditorStore.getState().update({ zoomRegions: [zoomRegion("a", 1000, 3000, "auto")] });
      withLayout(() => {
        renderWindow();
        const item = () => screen.getByRole("button", { name: /^Zoom 2×/ });
        expect(item()).not.toHaveAttribute("data-ghost");
        act(() => useEditorUiStore.getState().setPendingSuggestions(["a"]));
        expect(item()).toHaveAttribute("data-ghost", "true");
        act(() => useEditorUiStore.getState().clearPendingSuggestions());
        expect(item()).not.toHaveAttribute("data-ghost");
      });
    });

    it("'+' Zoom aims at the recorded cursor position", () => {
      const points: [number, number, number][] = [
        [0, 0.2, 0.3],
        [10_000, 0.6, 0.7],
      ];
      useProjectSession.getState().setSession({
        telemetry: {
          telemetry: { points, clicks: [], keys: [], scrolls: [] },
          cursorPoints: [],
        } as never,
      });
      renderWindow();
      act(() => {
        usePlaybackStore.getState().seek(5000);
      });
      fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));
      const focus = useEditorStore.getState().zoomRegions[0]?.focus;
      expect(focus?.x).toBeCloseTo(0.4);
      expect(focus?.y).toBeCloseTo(0.5);
    });
  });
});
