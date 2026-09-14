import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CropModal,
  DEFAULT_WEBCAM_SETTINGS,
  WebcamInspector,
  type WebcamInspectorProps,
  type WebcamSettings,
} from "./index";

const recorded = { kind: "recorded", durationMs: 42_000 } as const;

function setup(overrides: Partial<WebcamInspectorProps> = {}) {
  const props: WebcamInspectorProps = {
    value: DEFAULT_WEBCAM_SETTINGS,
    onChange: vi.fn(),
    source: recorded,
    onUpload: vi.fn(),
    onReplace: vi.fn(),
    onRemove: vi.fn(),
    onAutoSync: vi.fn(),
    ...overrides,
  };
  const utils = render(<WebcamInspector {...props} />);
  return { ...utils, props, onChange: props.onChange as ReturnType<typeof vi.fn> };
}

const lastValue = (fn: ReturnType<typeof vi.fn>): WebcamSettings =>
  fn.mock.calls.at(-1)?.[0] as WebcamSettings;

describe("WebcamInspector — no webcam", () => {
  it("shows the empty state and uploads", () => {
    const { props } = setup({ source: null });
    expect(screen.getByText("Add a webcam video")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Enabled" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upload video…" }));
    expect(props.onUpload).toHaveBeenCalledTimes(1);
  });
});

describe("WebcamInspector — source", () => {
  it("labels a recorded webcam with its duration; replace / remove fire", () => {
    const { props } = setup();
    expect(screen.getByText("Recorded webcam (00:42)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(props.onReplace).toHaveBeenCalledTimes(1);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it("labels an uploaded video by file name", () => {
    setup({ source: { kind: "uploaded", name: "face-cam.mov" } });
    expect(screen.getByText("face-cam.mov")).toBeInTheDocument();
  });
});

describe("WebcamInspector — enabled", () => {
  it("toggles enabled", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(lastValue(onChange).enabled).toBe(false);
  });

  it("disables all settings when the webcam is off, but keeps source actions", () => {
    setup({ value: { ...DEFAULT_WEBCAM_SETTINGS, enabled: false } });
    expect(screen.getByRole("group", { name: "Webcam settings" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Crop / reframe" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Mirror" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
  });

  it("changes shape, size, margin, mirror, border, shadow, zoom-reactive", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText("Pill"));
    expect(lastValue(onChange).shape).toBe("pill");
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "35" } });
    expect(lastValue(onChange).sizePct).toBe(35);
    fireEvent.change(screen.getByLabelText("Margin"), { target: { value: "64" } });
    expect(lastValue(onChange).marginPx).toBe(64);
    fireEvent.click(screen.getByRole("switch", { name: "Mirror" }));
    expect(lastValue(onChange).mirror).toBe(true);
    fireEvent.change(screen.getByLabelText("Border"), { target: { value: "4" } });
    expect(lastValue(onChange).borderWidth).toBe(4);
    fireEvent.change(screen.getByLabelText("Border color"), { target: { value: "#ff0000" } });
    expect(lastValue(onChange).borderColor).toBe("#ff0000");
    fireEvent.change(screen.getByLabelText("Shadow"), { target: { value: "80" } });
    expect(lastValue(onChange).shadow).toBe(80);
    fireEvent.click(screen.getByRole("switch", { name: "Zoom-reactive" }));
    expect(lastValue(onChange).zoomReactive).toBe(false);
    expect(screen.getByText("Shrinks during zooms to keep balance")).toBeInTheDocument();
  });

  it("only shows corner radius for the rounded shape", () => {
    const { rerender, props } = setup();
    expect(screen.queryByLabelText("Corner radius")).toBeNull();
    rerender(
      <WebcamInspector {...props} value={{ ...DEFAULT_WEBCAM_SETTINGS, shape: "rounded" }} />,
    );
    fireEvent.change(screen.getByLabelText("Corner radius"), { target: { value: "12" } });
    expect(lastValue(props.onChange as ReturnType<typeof vi.fn>).radius).toBe(12);
  });

  it("selects an anchor; custom X/Y switch to custom position", () => {
    const { onChange } = setup();
    const grid = screen.getByRole("radiogroup", { name: "Position" });
    expect(within(grid).getByRole("radio", { name: "bottom-left" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(within(grid).getByRole("radio", { name: "top-right" }));
    expect(lastValue(onChange).anchor).toBe("top-right");

    // bottom-left = (0, 100%); editing X keeps Y from the anchor.
    expect(screen.getByLabelText("Y")).toHaveValue(100);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "30" } });
    const v = lastValue(onChange);
    expect(v.anchor).toBeNull();
    expect(v.customX).toBeCloseTo(0.3);
    expect(v.customY).toBe(1);
  });

  it("shows custom X/Y and no selected anchor when position is custom", () => {
    setup({ value: { ...DEFAULT_WEBCAM_SETTINGS, anchor: null, customX: 0.25, customY: 0.4 } });
    expect(screen.getByLabelText("X")).toHaveValue(25);
    expect(screen.getByLabelText("Y")).toHaveValue(40);
    const checked = screen
      .queryAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked.filter((r) => r.closest("[aria-label='Position']"))).toHaveLength(0);
  });

  it("clamps sync offset and triggers auto-sync", () => {
    const { onChange, props } = setup();
    fireEvent.change(screen.getByLabelText("Sync offset"), { target: { value: "120" } });
    expect(lastValue(onChange).syncOffsetMs).toBe(120);
    fireEvent.change(screen.getByLabelText("Sync offset"), { target: { value: "-99999" } });
    expect(lastValue(onChange).syncOffsetMs).toBe(-5000);
    fireEvent.click(screen.getByRole("button", { name: "Auto-sync" }));
    expect(props.onAutoSync).toHaveBeenCalledTimes(1);
  });

  it("offers reset only when a crop exists", () => {
    const { rerender, props } = setup();
    expect(screen.queryByRole("button", { name: "Reset crop" })).toBeNull();
    rerender(
      <WebcamInspector
        {...props}
        value={{ ...DEFAULT_WEBCAM_SETTINGS, crop: { x: 0, y: 0, w: 100, h: 100 } }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));
    expect(lastValue(props.onChange as ReturnType<typeof vi.fn>).crop).toBeNull();
  });
});

describe("WebcamInspector — crop modal", () => {
  it("opens, zooms, applies a crop in source coords, and closes", () => {
    const { onChange } = setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Crop / reframe" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Crop / reframe")).toBeInTheDocument();
    expect(within(dialog).getByText("720×720")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Zoom"), { target: { value: "2" } });
    expect(within(dialog).getByText("360×360")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(lastValue(onChange).crop).toEqual({ x: 460, y: 180, w: 360, h: 360 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancel closes without changing settings", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Crop / reframe" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the pill aspect and a given source size", () => {
    setup({
      value: { ...DEFAULT_WEBCAM_SETTINGS, shape: "pill" },
      sourceSize: { width: 1920, height: 1080 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crop / reframe" }));
    expect(screen.getByText("1920×1080")).toBeInTheDocument();
    expect(screen.getByTestId("crop-overlay")).toHaveAttribute("data-shape", "pill");
  });
});

describe("CropModal", () => {
  const SRC = { width: 1280, height: 720 };
  const base = {
    open: true,
    shape: "circle" as const,
    sourceSize: SRC,
    value: null,
    onApply: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders nothing when closed", () => {
    render(<CropModal {...base} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("seeds zoom/center from an existing crop", () => {
    const onApply = vi.fn();
    render(<CropModal {...base} value={{ x: 0, y: 0, w: 360, h: 360 }} onApply={onApply} />);
    expect(screen.getByText("360×360")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const c = onApply.mock.calls[0]?.[0];
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.w).toBeCloseTo(360);
  });

  it("center on face uses the detector result", async () => {
    const onApply = vi.fn();
    const detect = vi.fn().mockResolvedValue({ x: 0, y: 0 });
    render(
      <CropModal
        {...base}
        value={{ x: 460, y: 180, w: 360, h: 360 }}
        onApply={onApply}
        onCenterOnFace={detect}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Center on face" }));
    });
    expect(detect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("center on face falls back to center on failure (null or throw)", async () => {
    const onApply = vi.fn();
    const detect = vi.fn().mockRejectedValue(new Error("no wasm"));
    render(
      <CropModal
        {...base}
        value={{ x: 0, y: 0, w: 360, h: 360 }}
        onApply={onApply}
        onCenterOnFace={detect}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Center on face" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({ x: 460, y: 180, w: 360, h: 360 });
  });

  it("centers without a detector", () => {
    const onApply = vi.fn();
    render(<CropModal {...base} value={{ x: 0, y: 0, w: 360, h: 360 }} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Center on face" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({ x: 460, y: 180 });
  });

  it("dragging the overlay repositions the crop, clamped to the source", () => {
    const onApply = vi.fn();
    render(<CropModal {...base} value={{ x: 460, y: 180, w: 360, h: 360 }} onApply={onApply} />);
    const frame = screen.getByTestId("crop-frame");
    frame.getBoundingClientRect = () => ({
      width: 640,
      height: 360,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 360,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(screen.getByTestId("crop-overlay"), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(frame, { clientX: 150, clientY: 100 }); // +50px of 640 → +100 source px
    fireEvent.mouseUp(frame);
    fireEvent.mouseMove(frame, { clientX: 600, clientY: 100 }); // ignored after mouseup
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply.mock.calls[0]?.[0].x).toBeCloseTo(560);

    fireEvent.mouseDown(screen.getByTestId("crop-overlay"), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(frame, { clientX: 5000, clientY: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply.mock.calls[1]?.[0]).toMatchObject({ x: 920, y: 360 });
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<CropModal {...base} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
