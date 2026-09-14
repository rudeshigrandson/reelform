import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ZOOM_SETTINGS, ZoomInspector, type ZoomInspectorProps, type ZoomRegion } from "./index";

const region = (over: Partial<ZoomRegion> = {}): ZoomRegion => ({
  id: "z1",
  startMs: 1000,
  endMs: 3000,
  level: 2,
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
  easeInMs: 600,
  easeOutMs: 700,
  curve: "ease-out-cubic",
  source: "auto",
  reason: "3 clicks",
  ...over,
});

function setup(over: Partial<ZoomInspectorProps> = {}) {
  const props: ZoomInspectorProps = {
    settings: DEFAULT_ZOOM_SETTINGS,
    onSettingsChange: vi.fn(),
    selectedRegion: null,
    onRegionChange: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onGenerate: vi.fn(),
    status: "idle",
    hasTelemetry: true,
    hasSuggestions: false,
    timelineDurationMs: 10_000,
    ...over,
  };
  const utils = render(<ZoomInspector {...props} />);
  return { props, ...utils };
}

const lastRegion = (fn: ZoomInspectorProps["onRegionChange"]): ZoomRegion =>
  vi.mocked(fn).mock.calls.at(-1)![0];

describe("ZoomInspector — no selection", () => {
  it("shows the helper and global sections", () => {
    setup();
    expect(screen.getByText("Select a zoom on the timeline or add one at the playhead (+)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate suggestions" })).toBeEnabled();
    expect(screen.getByLabelText("Camera smoothing")).toBeInTheDocument();
    expect(screen.queryByLabelText("Zoom level")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("generates and says Regenerate when suggestions exist", () => {
    const { props } = setup({ hasSuggestions: true });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("updates auto-zoom settings", () => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText("Sensitivity"), { target: { value: "80" } });
    expect(props.onSettingsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_ZOOM_SETTINGS,
      autoZoom: { ...DEFAULT_ZOOM_SETTINGS.autoZoom, sensitivity: 0.8 },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Zoom on typing" }));
    expect(vi.mocked(props.onSettingsChange).mock.calls.at(-1)![0].autoZoom.zoomOnTyping).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Follow cursor while zoomed" }));
    expect(vi.mocked(props.onSettingsChange).mock.calls.at(-1)![0].autoZoom.followCursor).toBe(false);
  });

  it("updates motion settings", () => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText("Max zoom speed"), { target: { value: "6.5" } });
    expect(vi.mocked(props.onSettingsChange).mock.calls.at(-1)![0].camera).toEqual({ smoothing: 0.5, maxZoomSpeed: 6.5 });
    fireEvent.change(screen.getByLabelText("Camera smoothing"), { target: { value: "20" } });
    expect(vi.mocked(props.onSettingsChange).mock.calls.at(-1)![0].camera.smoothing).toBe(0.2);
  });
});

describe("ZoomInspector — suggestions pending", () => {
  it("shows the spinner and blocks regenerate", () => {
    const { props } = setup({ status: "analyzing", hasSuggestions: true });
    expect(screen.getByText("Analyzing cursor activity…")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Regenerate" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it("hides the spinner when idle", () => {
    setup();
    expect(screen.queryByText("Analyzing cursor activity…")).toBeNull();
  });
});

describe("ZoomInspector — no telemetry", () => {
  it("disables auto-zoom with an explanation but keeps manual editing", () => {
    const { props } = setup({ hasTelemetry: false, selectedRegion: region() });
    expect(screen.getByText("Auto-zoom unavailable")).toBeInTheDocument();
    expect(screen.getByText(/no cursor data/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate suggestions" })).toBeDisabled();
    expect(screen.getByLabelText("Sensitivity")).toBeDisabled();
    for (const name of ["Follow cursor while zoomed", "Zoom on clicks", "Zoom on typing"]) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("z1");
    expect(screen.getByLabelText("Camera smoothing")).toBeEnabled();
  });
});

describe("ZoomInspector — region selected", () => {
  it("renders region values", () => {
    setup({ selectedRegion: region() });
    expect(screen.getByLabelText("Zoom level")).toHaveValue("2");
    expect(screen.getByLabelText("Level")).toHaveValue(2);
    expect(screen.getByLabelText("Start")).toHaveValue("00:01.00");
    expect(screen.getByLabelText("End")).toHaveValue("00:03.00");
    expect(screen.getByTestId("zoom-duration")).toHaveTextContent("00:02.00");
    expect(screen.getByRole("radio", { name: "center" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Ease")).toBeChecked();
    expect(screen.getByRole("img", { name: "Ease curve preview" })).toBeInTheDocument();
    expect(screen.getByText(/Set from canvas/)).toBeInTheDocument();
    expect(screen.queryByText("Select a zoom on the timeline or add one at the playhead (+)")).toBeNull();
  });

  it("clamps level edits and marks manual", () => {
    const { props } = setup({ selectedRegion: region() });
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "7" } });
    expect(lastRegion(props.onRegionChange)).toMatchObject({ level: 4, source: "manual" });
    fireEvent.change(screen.getByLabelText("Zoom level"), { target: { value: "1.5" } });
    expect(lastRegion(props.onRegionChange).level).toBe(1.5);
  });

  it("edits focus via grid, follow switch and X/Y", () => {
    const { props } = setup({ selectedRegion: region() });
    fireEvent.click(screen.getByRole("radio", { name: "top-left" }));
    expect(lastRegion(props.onRegionChange).focus).toEqual({ mode: "fixed", x: 0, y: 0 });
    fireEvent.click(screen.getByRole("switch", { name: "Follow cursor" }));
    expect(lastRegion(props.onRegionChange).focus.mode).toBe("follow");
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "25" } });
    expect(lastRegion(props.onRegionChange).focus).toMatchObject({ x: 0.25, y: 0.5 });
  });

  it("disables fixed-focus inputs while following the cursor", () => {
    setup({ selectedRegion: region({ focus: { mode: "follow", x: 0.3, y: 0.3 } }) });
    expect(screen.getByLabelText("X")).toBeDisabled();
    expect(screen.getByRole("radio", { name: "center" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Follow cursor" })).toHaveAttribute("aria-checked", "true");
  });

  it("marks no anchor for a custom focus point", () => {
    setup({ selectedRegion: region({ focus: { mode: "fixed", x: 0.3, y: 0.7 } }) });
    for (const r of screen.getAllByRole("radio").filter((el) => el.tagName === "BUTTON")) {
      expect(r).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByLabelText("Y")).toHaveValue(70);
  });

  it("edits easing and curve", () => {
    const { props } = setup({ selectedRegion: region() });
    fireEvent.change(screen.getByLabelText("Ease in"), { target: { value: "400" } });
    expect(lastRegion(props.onRegionChange).easeInMs).toBe(400);
    fireEvent.change(screen.getByLabelText("Ease out"), { target: { value: "9000" } });
    expect(lastRegion(props.onRegionChange).easeOutMs).toBe(3000);
    fireEvent.click(screen.getByLabelText("Spring"));
    expect(lastRegion(props.onRegionChange).curve).toBe("spring");
  });

  it("shows the preview for the active curve", () => {
    setup({ selectedRegion: region({ curve: "linear" }) });
    expect(screen.getByRole("img", { name: "Linear curve preview" })).toBeInTheDocument();
  });

  it("commits timing on Enter and clamps within the timeline", () => {
    const { props } = setup({ selectedRegion: region() });
    const end = screen.getByLabelText("End");
    fireEvent.change(end, { target: { value: "0:25" } });
    fireEvent.keyDown(end, { key: "Enter" });
    expect(lastRegion(props.onRegionChange).endMs).toBe(10_000);
    expect(end).toHaveValue("00:10.00");

    const start = screen.getByLabelText("Start");
    fireEvent.change(start, { target: { value: "2.5" } });
    fireEvent.blur(start);
    expect(lastRegion(props.onRegionChange).startMs).toBe(2500);
  });

  it("keeps start before end", () => {
    const { props } = setup({ selectedRegion: region() });
    const start = screen.getByLabelText("Start");
    fireEvent.change(start, { target: { value: "9" } });
    fireEvent.blur(start);
    expect(lastRegion(props.onRegionChange).startMs).toBe(2900);
  });

  it("reverts invalid or escaped timing without emitting", () => {
    const { props } = setup({ selectedRegion: region() });
    const start = screen.getByLabelText("Start");
    fireEvent.change(start, { target: { value: "soon" } });
    fireEvent.blur(start);
    expect(start).toHaveValue("00:01.00");
    fireEvent.change(start, { target: { value: "2" } });
    fireEvent.keyDown(start, { key: "Escape" });
    expect(start).toHaveValue("00:01.00");
    fireEvent.blur(start);
    expect(props.onRegionChange).not.toHaveBeenCalled();
  });

  it("resyncs timing fields when the region changes externally", () => {
    const { rerender, props } = setup({ selectedRegion: region() });
    rerender(<ZoomInspector {...props} selectedRegion={region({ id: "z9", startMs: 4000, endMs: 6500 })} />);
    expect(screen.getByLabelText("Start")).toHaveValue("00:04.00");
    expect(screen.getByTestId("zoom-duration")).toHaveTextContent("00:02.50");
  });

  it("duplicates and deletes by id", () => {
    const { props } = setup({ selectedRegion: region({ id: "abc" }) });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDuplicate).toHaveBeenCalledWith("abc");
    expect(props.onDelete).toHaveBeenCalledWith("abc");
  });
});
