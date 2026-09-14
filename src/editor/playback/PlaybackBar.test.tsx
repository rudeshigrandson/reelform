import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackBar, type PlaybackBarProps } from "./PlaybackBar";

function setup(overrides: Partial<PlaybackBarProps> = {}) {
  const props: PlaybackBarProps = {
    currentMs: 12_340,
    durationMs: 64_000,
    fps: 30,
    isPlaying: false,
    loop: false,
    snapEnabled: true,
    timelineZoom: 0.5,
    onTogglePlay: vi.fn(),
    onStepFrame: vi.fn(),
    onSkipStart: vi.fn(),
    onSkipEnd: vi.fn(),
    onLoopChange: vi.fn(),
    onSplit: vi.fn(),
    onDelete: vi.fn(),
    canDelete: true,
    onSnapChange: vi.fn(),
    onTimelineZoomChange: vi.fn(),
    onFit: vi.fn(),
    ...overrides,
  };
  const utils = render(<PlaybackBar {...props} />);
  return { props, ...utils };
}

describe("PlaybackBar", () => {
  it("shows the readout", () => {
    setup();
    expect(screen.getByTestId("playback-current")).toHaveTextContent("00:12.340");
    expect(screen.getByTestId("playback-total")).toHaveTextContent("01:04.000");
    expect(screen.getByRole("toolbar", { name: "Playback" })).toBeInTheDocument();
  });

  it("swaps play/pause label with shortcut tooltip", () => {
    const { rerender, props } = setup();
    const play = screen.getByRole("button", { name: "Play (Space)" });
    expect(play).toHaveAttribute("title", "Play (Space)");
    rerender(<PlaybackBar {...props} isPlaying />);
    expect(screen.getByRole("button", { name: "Pause (Space)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play (Space)" })).toBeNull();
  });

  it("buttons call their handlers", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Play (Space)" }));
    fireEvent.click(screen.getByRole("button", { name: "Back 1 frame (←)" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 1 frame (→)" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip to start (Home)" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip to end (End)" }));
    fireEvent.click(screen.getByRole("button", { name: "Split at playhead (S)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selection (Delete)" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out timeline" }));
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1);
    expect(props.onStepFrame).toHaveBeenNthCalledWith(1, -1);
    expect(props.onStepFrame).toHaveBeenNthCalledWith(2, 1);
    expect(props.onSkipStart).toHaveBeenCalledTimes(1);
    expect(props.onSkipEnd).toHaveBeenCalledTimes(1);
    expect(props.onSplit).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onFit).toHaveBeenCalledTimes(1);
    expect(props.onTimelineZoomChange).toHaveBeenNthCalledWith(1, 0.6);
    expect(props.onTimelineZoomChange).toHaveBeenNthCalledWith(2, 0.4);
  });

  it("disables delete when nothing can be deleted", () => {
    const { props } = setup({ canDelete: false });
    const del = screen.getByRole("button", { name: "Delete selection (Delete)" });
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("loop and snap expose aria-pressed and toggle", () => {
    const { props } = setup({ loop: true, snapEnabled: false });
    const loop = screen.getByRole("button", { name: "Loop" });
    const snap = screen.getByRole("button", { name: "Snap" });
    expect(loop).toHaveAttribute("aria-pressed", "true");
    expect(snap).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(loop);
    fireEvent.click(snap);
    expect(props.onLoopChange).toHaveBeenCalledWith(false);
    expect(props.onSnapChange).toHaveBeenCalledWith(true);
  });

  it("zoom slider reports changes and clamps at the ends", () => {
    const { props } = setup({ timelineZoom: 1 });
    const slider = screen.getByRole("slider", { name: "Timeline zoom" });
    expect(slider).toHaveValue("1");
    fireEvent.change(slider, { target: { value: "0.25" } });
    expect(props.onTimelineZoomChange).toHaveBeenCalledWith(0.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in timeline" }));
    expect(props.onTimelineZoomChange).toHaveBeenLastCalledWith(1);
  });
});
