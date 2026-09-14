import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AudioInspector,
  type AudioInspectorProps,
  type AudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  WAVEFORM_BARS,
  addRegion,
  updateTrack,
} from "./index";

const music = {
  id: "r1",
  fileName: "lofi-beat.mp3",
  path: "audio/lofi-beat.mp3",
  startMs: 0,
  endMs: 2000,
};

function setup(overrides: Partial<AudioInspectorProps> = {}) {
  const onChange = vi.fn<(next: AudioSettings) => void>();
  const onAddAudio = vi.fn();
  const props: AudioInspectorProps = {
    value: DEFAULT_AUDIO_SETTINGS,
    onChange,
    onAddAudio,
    availableTracks: { mic: true, system: true },
    ...overrides,
  };
  render(<AudioInspector {...props} />);
  const last = (): AudioSettings => onChange.mock.lastCall![0];
  return { onChange, onAddAudio, last };
}

describe("AudioInspector states", () => {
  it("only mic: shows mic controls and explains missing system audio", () => {
    setup({ availableTracks: { mic: true, system: false } });
    const mic = screen.getByRole("group", { name: "Microphone" });
    expect(within(mic).getByRole("switch", { name: "Noise reduction" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "System audio" })).toBeNull();
    expect(screen.getByText("System audio not available")).toBeInTheDocument();
    expect(screen.getByText(/System audio wasn't captured/)).toBeInTheDocument();
  });

  it("mic + system: both tracks, noise reduction only on mic", () => {
    setup();
    const system = screen.getByRole("group", { name: "System audio" });
    expect(screen.getByRole("group", { name: "Microphone" })).toBeInTheDocument();
    expect(within(system).queryByRole("switch", { name: "Noise reduction" })).toBeNull();
    expect(within(system).getByRole("switch", { name: "Normalize" })).toBeInTheDocument();
    expect(screen.queryByText(/not available/)).toBeNull();
    expect(screen.getByText("No extra audio")).toBeInTheDocument();
  });

  it("extra music with ducking on", () => {
    const { last } = setup({ value: addRegion(DEFAULT_AUDIO_SETTINGS, music) });
    const region = screen.getByRole("group", { name: "lofi-beat.mp3" });
    const duck = within(region).getByRole("switch", { name: "Duck under voice" });
    expect(duck).toHaveAttribute("aria-checked", "true");
    expect(duck).not.toBeDisabled();
    const amount = within(region).getByLabelText("Duck amount");
    expect(amount).not.toBeDisabled();
    fireEvent.change(amount, { target: { value: "20" } });
    expect(last().regions[0]!.duck).toEqual({ enabled: true, amountDb: 20 });
    expect(screen.queryByText("No extra audio")).toBeNull();
  });

  it("a track missing uses a custom reason when given", () => {
    setup({
      availableTracks: { mic: false, system: true },
      missingTrackReason: { mic: "Mic permission was denied." },
    });
    expect(screen.getByText("Microphone not available")).toBeInTheDocument();
    expect(screen.getByText("Mic permission was denied.")).toBeInTheDocument();
  });

  it("no recorded tracks: combined message, extra audio still available, ducking disabled", () => {
    const { onAddAudio } = setup({
      availableTracks: { mic: false, system: false },
      value: addRegion(DEFAULT_AUDIO_SETTINGS, music),
    });
    expect(screen.getByText("No recorded audio")).toBeInTheDocument();
    const region = screen.getByRole("group", { name: "lofi-beat.mp3" });
    expect(within(region).getByRole("switch", { name: "Duck under voice" })).toBeDisabled();
    expect(within(region).getByText("Needs a microphone track")).toBeInTheDocument();
    expect(within(region).getByLabelText("Duck amount")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add audio…" }));
    expect(onAddAudio).toHaveBeenCalledTimes(1);
  });

  it("shows solo silencing hint on the other track", () => {
    setup({ value: updateTrack(DEFAULT_AUDIO_SETTINGS, "mic", { solo: true }) });
    const system = screen.getByRole("group", { name: "System audio" });
    expect(within(system).getByText(/another track is soloed/)).toBeInTheDocument();
    const mic = screen.getByRole("group", { name: "Microphone" });
    expect(within(mic).queryByText(/another track is soloed/)).toBeNull();
    expect(within(mic).getByRole("button", { name: "Solo Microphone" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("AudioInspector callbacks", () => {
  it("mute, solo, normalize, noise reduction", () => {
    const { last, onChange } = setup();
    const mic = screen.getByRole("group", { name: "Microphone" });
    fireEvent.click(within(mic).getByRole("button", { name: "Mute Microphone" }));
    expect(last().tracks.mic.muted).toBe(true);
    fireEvent.click(within(mic).getByRole("button", { name: "Solo Microphone" }));
    expect(last().tracks.mic.solo).toBe(true);
    fireEvent.click(within(mic).getByRole("switch", { name: "Noise reduction" }));
    expect(last().tracks.mic.noiseReduction).toBe(true);
    const system = screen.getByRole("group", { name: "System audio" });
    fireEvent.click(within(system).getByRole("switch", { name: "Normalize" }));
    expect(last().tracks.system.normalize).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("volume slider maps position to dB, bottom is −∞", () => {
    const { last } = setup({
      value: updateTrack(DEFAULT_AUDIO_SETTINGS, "system", { volumeDb: 6 }),
    });
    const system = screen.getByRole("group", { name: "System audio" });
    expect(within(system).getByText("+6.0 dB")).toBeInTheDocument();
    const slider = within(system).getByLabelText("Volume");
    expect(slider).toHaveAttribute("aria-valuetext", "+6.0 dB");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(last().tracks.system.volumeDb).toBe(Number.NEGATIVE_INFINITY);
    fireEvent.change(slider, { target: { value: "600" } });
    expect(last().tracks.system.volumeDb).toBe(0);
  });

  it("track fades are clamped to the recording duration", () => {
    const value = updateTrack(DEFAULT_AUDIO_SETTINGS, "mic", { fadeOutMs: 800 }, 1000);
    const { last } = setup({ value, trackDurationMs: 1000 });
    const mic = screen.getByRole("group", { name: "Microphone" });
    fireEvent.change(within(mic).getByLabelText("Fade in"), { target: { value: "500" } });
    expect(last().tracks.mic).toMatchObject({ fadeInMs: 500, fadeOutMs: 500 });
  });

  it("region: loop, duck off, fade, volume, remove", () => {
    const value = addRegion(DEFAULT_AUDIO_SETTINGS, music);
    const { last } = setup({ value });
    const region = screen.getByRole("group", { name: "lofi-beat.mp3" });
    fireEvent.click(within(region).getByRole("switch", { name: "Loop" }));
    expect(last().regions[0]!.loop).toBe(true);
    fireEvent.click(within(region).getByRole("switch", { name: "Duck under voice" }));
    expect(last().regions[0]!.duck.enabled).toBe(false);
    fireEvent.change(within(region).getByLabelText("Fade out"), { target: { value: "5000" } });
    expect(last().regions[0]!.fadeOutMs).toBe(2000);
    fireEvent.change(within(region).getByLabelText("Volume"), { target: { value: "540" } });
    expect(last().regions[0]!.volumeDb).toBe(-6);
    fireEvent.click(within(region).getByRole("button", { name: "Remove lofi-beat.mp3" }));
    expect(last().regions).toEqual([]);
  });

  it("duck amount is disabled when ducking is off", () => {
    const value = addRegion(DEFAULT_AUDIO_SETTINGS, music);
    const off = {
      ...value,
      regions: [{ ...value.regions[0]!, duck: { enabled: false, amountDb: 12 } }],
    };
    setup({ value: off });
    expect(screen.getByLabelText("Duck amount")).toBeDisabled();
  });

  it("master volume, mute all, click volume", () => {
    const { last } = setup();
    fireEvent.change(screen.getByLabelText("Output volume"), { target: { value: "0" } });
    expect(last().master.volumeDb).toBe(Number.NEGATIVE_INFINITY);
    fireEvent.click(screen.getByRole("switch", { name: "Mute all" }));
    expect(last().master.muteAll).toBe(true);
    fireEvent.change(screen.getByLabelText("Cursor click sounds"), { target: { value: "25" } });
    expect(last().clickVolume).toBe(25);
    expect(screen.getByText("60%")).toBeInTheDocument();
  });
});

describe("AudioInspector waveform", () => {
  it("renders at most WAVEFORM_BARS bars and a placeholder when no peaks", () => {
    const peaks = Array.from({ length: 500 }, (_, i) => (i % 10) / 10);
    setup({ waveforms: { mic: peaks } });
    expect(screen.getByTestId("waveform-mic").querySelectorAll("rect")).toHaveLength(WAVEFORM_BARS);
    expect(screen.getByTestId("waveform-system")).toHaveAttribute("data-empty", "true");
  });

  it("renders one bar per peak for short inputs", () => {
    setup({ waveforms: { system: [0.1, 0.9, 0.4] } });
    expect(screen.getByTestId("waveform-system").querySelectorAll("rect")).toHaveLength(3);
  });
});
