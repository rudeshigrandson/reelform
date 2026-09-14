import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EFFECTS_SETTINGS,
  DEFAULT_TITLE_CARD,
  EffectsInspector,
  RemoveSilenceDialog,
  type AudioEnvelope,
  type CursorSample,
  type EffectsInspectorProps,
  type SpeedRegionEdit,
} from "./index";

const region: SpeedRegionEdit = {
  id: "s1",
  startMs: 0,
  endMs: 2000,
  rate: 2,
  keepPitch: true,
  rampInMs: 100,
  rampOutMs: 100,
};

// 10 windows/s: 1s loud, 2s silent, 1s loud, 1.5s silent → 2 gaps, 3.5s total
const envelope: AudioEnvelope = {
  envelopeDb: [...Array(10).fill(-10), ...Array(20).fill(-70), ...Array(10).fill(-10), ...Array(15).fill(-70)],
  sampleRateHz: 10,
};

const idleSamples: CursorSample[] = Array.from({ length: 51 }, (_, i) => ({ tMs: i * 100, x: 0.5, y: 0.5 }));

function setup(over: Partial<EffectsInspectorProps> = {}) {
  const props: EffectsInspectorProps = {
    value: DEFAULT_EFFECTS_SETTINGS,
    onChange: vi.fn(),
    selectedSpeedRegion: null,
    onSpeedRegionChange: vi.fn(),
    envelope,
    onApplyRemoveSilence: vi.fn(),
    cursorSamples: idleSamples,
    onAutoSpeedIdle: vi.fn(),
    ...over,
  };
  const utils = render(<EffectsInspector {...props} />);
  return { props, ...utils };
}

describe("EffectsInspector — default", () => {
  it("renders all sections and an empty speed state", () => {
    setup();
    for (const t of ["Speed", "Transitions", "Intro / Outro", "Color", "Motion"]) {
      expect(screen.getByRole("button", { name: new RegExp(t) })).toBeInTheDocument();
    }
    expect(screen.getByText("No speed region selected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ramp in")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables tools without audio or cursor data", () => {
    setup({ envelope: null, cursorSamples: null });
    expect(screen.getByRole("button", { name: "Remove silence…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Auto speed-up idle" })).toBeDisabled();
  });
});

describe("EffectsInspector — speed region selected", () => {
  it("shows region controls and emits normalized edits", () => {
    const { props } = setup({ selectedSpeedRegion: region });
    const onRegion = props.onSpeedRegionChange as ReturnType<typeof vi.fn>;
    expect(screen.getByText("2×")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "4" } });
    expect(onRegion).toHaveBeenLastCalledWith({ ...region, rate: 4 });

    fireEvent.click(screen.getByRole("switch", { name: "Keep pitch" }));
    expect(onRegion).toHaveBeenLastCalledWith({ ...region, keepPitch: false });

    // Ramp capped at half the region (1000ms)
    fireEvent.change(screen.getByLabelText("Ramp in"), { target: { value: "5000" } });
    expect(onRegion).toHaveBeenLastCalledWith({ ...region, rampInMs: 1000 });

    fireEvent.change(screen.getByLabelText("Ramp out"), { target: { value: "250" } });
    expect(onRegion).toHaveBeenLastCalledWith({ ...region, rampOutMs: 250 });
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe("EffectsInspector — remove-silence dialog", () => {
  it("opens from the tool, previews gaps, and applies", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove silence…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Would remove 2 gaps (00:04 total)")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(props.onApplyRemoveSilence).toHaveBeenCalledWith(
      [
        { startMs: 1000, endMs: 3000 },
        { startMs: 4000, endMs: 5500 },
      ],
      { thresholdDb: -40, minSilenceMs: 700 },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can render open initially and cancel without applying", () => {
    const { props } = setup({ initialRemoveSilenceOpen: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onApplyRemoveSilence).not.toHaveBeenCalled();
  });
});

describe("RemoveSilenceDialog", () => {
  it("updates the preview as min length changes and disables Remove at zero gaps", () => {
    render(<RemoveSilenceDialog open onClose={vi.fn()} envelope={envelope} onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Min silence"), { target: { value: "1800" } });
    expect(screen.getByText("Would remove 1 gap (00:02 total)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Min silence"), { target: { value: "5000" } });
    expect(screen.getByText("No silent gaps found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("threshold below the silence level finds nothing", () => {
    render(<RemoveSilenceDialog open onClose={vi.fn()} envelope={envelope} onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "-80" } });
    expect(screen.getByText("No silent gaps found")).toBeInTheDocument();
    expect(screen.getByText("-80 dB")).toBeInTheDocument();
  });

  it("shows a no-audio message when envelope is null", () => {
    render(<RemoveSilenceDialog open onClose={vi.fn()} envelope={null} onApply={vi.fn()} />);
    expect(screen.getByText("No audio to analyze")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<RemoveSilenceDialog open onClose={onClose} envelope={envelope} onApply={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("EffectsInspector — auto speed-up idle", () => {
  it("emits suggested 3× regions for idle cursor", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Auto speed-up idle" }));
    expect(props.onAutoSpeedIdle).toHaveBeenCalledWith([
      { id: "idle-0-0", startMs: 0, endMs: 5000, rate: 3, keepPitch: true, rampInMs: 300, rampOutMs: 300 },
    ]);
  });

  it("shows a notice and emits nothing when there is no idle section", () => {
    const moving = Array.from({ length: 50 }, (_, i) => ({ tMs: i * 100, x: i / 50, y: 0.5 }));
    const { props } = setup({ cursorSamples: moving });
    fireEvent.click(screen.getByRole("button", { name: "Auto speed-up idle" }));
    expect(props.onAutoSpeedIdle).not.toHaveBeenCalled();
    expect(screen.getByText("No idle sections found")).toBeInTheDocument();
  });
});

describe("EffectsInspector — intro card", () => {
  it("adds an intro card with defaults", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add intro title card" }));
    expect(props.onChange).toHaveBeenCalledWith({ ...DEFAULT_EFFECTS_SETTINGS, intro: DEFAULT_TITLE_CARD });
  });

  it("intro card added: edits text, bg, duration and removes", () => {
    const value = { ...DEFAULT_EFFECTS_SETTINGS, intro: { ...DEFAULT_TITLE_CARD, text: "Hello" } };
    const { props } = setup({ value });
    const onChange = props.onChange as ReturnType<typeof vi.fn>;
    const group = screen.getByRole("group", { name: "Intro title card" });
    expect(within(group).getByDisplayValue("Hello")).toBeInTheDocument();
    // outro still offers add
    expect(screen.getByRole("button", { name: "Add outro title card" })).toBeInTheDocument();

    fireEvent.change(within(group).getByLabelText("Intro text"), { target: { value: "Welcome" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, intro: { ...value.intro, text: "Welcome" } });

    fireEvent.change(within(group).getByLabelText("Intro background"), { target: { value: "#ff0000" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, intro: { ...value.intro, bg: "#ff0000" } });

    fireEvent.change(within(group).getByLabelText("Intro duration"), { target: { value: "99999" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, intro: { ...value.intro, durationMs: 10000 } });

    fireEvent.click(within(group).getByRole("button", { name: "Remove intro title card" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, intro: null });
  });
});

describe("EffectsInspector — transitions, color, motion", () => {
  it("changes transition kind; duration disabled for None", () => {
    const { props, rerender } = setup();
    expect(screen.getByLabelText("Duration")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Cross-dissolve"));
    const next = { ...DEFAULT_EFFECTS_SETTINGS, transition: { kind: "cross-dissolve" as const, durationMs: 400 } };
    expect(props.onChange).toHaveBeenLastCalledWith(next);
    rerender(<EffectsInspector {...props} value={next} />);
    expect(screen.getByLabelText("Duration")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "10" } });
    expect(props.onChange).toHaveBeenLastCalledWith({ ...next, transition: { ...next.transition, durationMs: 100 } });
  });

  it("color sliders, grain, and motion switches patch only their field", () => {
    const { props } = setup();
    const onChange = props.onChange as ReturnType<typeof vi.fn>;
    const d = DEFAULT_EFFECTS_SETTINGS;
    fireEvent.change(screen.getByLabelText("Brightness"), { target: { value: "20" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...d, color: { ...d.color, brightness: 20 } });
    fireEvent.change(screen.getByLabelText("Saturation"), { target: { value: "-50" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...d, color: { ...d.color, saturation: -50 } });
    fireEvent.change(screen.getByLabelText("Vignette"), { target: { value: "40" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...d, color: { ...d.color, vignette: 40 } });
    fireEvent.click(screen.getByRole("switch", { name: "Grain" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...d, color: { ...d.color, grain: true } });
    fireEvent.click(screen.getByRole("switch", { name: "Subtle 3D tilt on zooms" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...d, motion: { ...d.motion, tilt3d: true } });
    fireEvent.click(screen.getByRole("switch", { name: "Parallax background" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...d, motion: { ...d.motion, parallax: true } });
  });
});
