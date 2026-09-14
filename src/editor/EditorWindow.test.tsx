import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorWindow } from "./EditorWindow";
import { usePlaybackStore } from "./playback";
import type { CreatePreviewStage, PreviewStage, SceneState } from "./preview";
import { useEditorStore } from "./store";

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
});

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
});
