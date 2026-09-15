import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordingHud, formatElapsed } from "./RecordingHud";
import { sampleHudProps } from "./types";
import type { RecordingHudProps } from "./types";

function renderHud(overrides: Partial<RecordingHudProps> = {}) {
  const onStop = vi.fn();
  const onPauseToggle = vi.fn();
  const onDiscard = vi.fn();
  const props: RecordingHudProps = {
    ...sampleHudProps,
    onStop,
    onPauseToggle,
    onDiscard,
    ...overrides,
  };
  render(<RecordingHud {...props} />);
  return { onStop, onPauseToggle, onDiscard };
}

describe("formatElapsed", () => {
  it("formats milliseconds to mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3_599_000)).toBe("59:59");
    expect(formatElapsed(-500)).toBe("00:00");
  });
});

describe("RecordingHud", () => {
  it("renders the elapsed timer as mm:ss", () => {
    renderHud({ elapsedMs: 125_000 });
    expect(screen.getByTestId("hud-timer")).toHaveTextContent("02:05");
  });

  it("Stop calls onStop", () => {
    const { onStop } = renderHud();
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("Pause calls onPauseToggle", () => {
    const { onPauseToggle } = renderHud({ phase: "recording" });
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(onPauseToggle).toHaveBeenCalledOnce();
  });

  it("Discard confirms inline inside the pill and confirming calls onDiscard", () => {
    const { onDiscard } = renderHud();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    const confirm = screen.getByRole("alertdialog", { name: "Discard recording?" });
    // Rendered in the pill itself (no portal / overlay that the 560x64 window would clip).
    expect(confirm).toHaveAttribute("data-testid", "recording-hud");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop recording" })).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Keep recording and Escape dismiss the inline confirm without discarding", () => {
    const { onDiscard } = renderHud({ phase: "paused" });
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("shows the countdown value during the countdown phase", () => {
    renderHud({ phase: "countdown", countdownValue: 3 });
    expect(screen.getByTestId("countdown-value")).toHaveTextContent("3");
    // controls are hidden during countdown
    expect(screen.queryByRole("button", { name: "Stop recording" })).toBeNull();
  });

  it("renders the warning tag when a warning is set", () => {
    renderHud({ warning: "Cursor can't be hidden" });
    expect(screen.getByTestId("hud-warning")).toHaveTextContent("Cursor can't be hidden");
  });

  it("omits the warning tag when no warning is set", () => {
    renderHud({ warning: undefined });
    expect(screen.queryByTestId("hud-warning")).toBeNull();
  });

  it("shows the Paused tag and dims the timer when paused", () => {
    renderHud({ phase: "paused" });
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
  });

  it("renders a muted mic meter when micLevel is undefined", () => {
    renderHud({ micLevel: undefined });
    const meter = screen.getByTestId("mic-meter");
    expect(meter).toHaveAttribute("aria-disabled", "true");
    const lit = meter.querySelectorAll('[data-lit="true"]');
    expect(lit.length).toBe(0);
  });

  it("lights meter bars proportional to micLevel", () => {
    renderHud({ micLevel: 0.5 });
    const meter = screen.getByTestId("mic-meter");
    const lit = meter.querySelectorAll('[data-lit="true"]');
    expect(lit.length).toBe(6);
  });

  it("finalizing shows a processing status without recording controls", () => {
    renderHud({ phase: "finalizing", elapsedMs: 42_000 });
    expect(screen.getByTestId("hud-status")).toHaveTextContent("Processing recording…");
    expect(screen.getByTestId("hud-processing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop recording" })).toBeNull();
  });

  it("interrupted shows what was saved and why", () => {
    renderHud({
      phase: "interrupted",
      elapsedMs: 42_000,
      interruptedMessage: "The display was disconnected",
    });
    const status = screen.getByTestId("hud-status");
    expect(status).toHaveTextContent("Recording saved up to 00:42");
    expect(status).toHaveTextContent("The display was disconnected");
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard recording" })).toBeNull();
  });
});
