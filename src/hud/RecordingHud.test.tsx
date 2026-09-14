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

  it("Discard opens a confirm dialog and confirming calls onDiscard", () => {
    const { onDiscard } = renderHud();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
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
});
