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
