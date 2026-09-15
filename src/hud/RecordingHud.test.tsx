import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingHud, formatElapsed, formatTimerTenths } from "./RecordingHud";
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
  const utils = render(<RecordingHud {...props} />);
  return { onStop, onPauseToggle, onDiscard, ...utils };
}

const openMenu = () =>
  fireEvent.click(screen.getByRole("button", { name: "More recording options" }));

afterEach(() => {
  delete document.documentElement.dataset.reduceMotion;
});

describe("formatElapsed / formatTimerTenths", () => {
  it("formats milliseconds to mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3_599_000)).toBe("59:59");
    expect(formatElapsed(-500)).toBe("00:00");
  });

  it("formats the S10 timer with tenths", () => {
    expect(formatTimerTenths(0)).toBe("00:00.0");
    expect(formatTimerTenths(42_180)).toBe("00:42.1");
    expect(formatTimerTenths(65_999)).toBe("01:05.9");
    expect(formatTimerTenths(-10)).toBe("00:00.0");
    expect(formatTimerTenths(Number.NaN)).toBe("00:00.0");
  });
});

describe("RecordingHud (S10)", () => {
  it("is a 300x48 pill with dot, tenths timer, meter, Pause, Stop and overflow", () => {
    renderHud({ elapsedMs: 42_180 });
    const pill = screen.getByTestId("recording-hud");
    expect(pill).toHaveStyle({ width: "300px", height: "48px" });
    expect(screen.getByTestId("hud-timer")).toHaveTextContent("00:42.1");
    expect(screen.getByTestId("hud-record-dot")).toHaveAttribute("data-pulse", "true");
    expect(screen.getByTestId("mic-meter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More recording options" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("Stop and Pause call their handlers", () => {
    const { onStop, onPauseToggle } = renderHud();
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onPauseToggle).toHaveBeenCalledOnce();
  });

  it("paused: Resume replaces Pause, the dot stops pulsing", () => {
    renderHud({ phase: "paused" });
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
    expect(screen.getByTestId("hud-record-dot")).toHaveAttribute("data-pulse", "false");
    expect(screen.getByTestId("hud-timer")).toHaveAttribute("aria-label", "Paused");
  });

  it("reduce motion: the dot is solid", () => {
    document.documentElement.dataset.reduceMotion = "true";
    renderHud();
    expect(screen.getByTestId("hud-record-dot")).toHaveAttribute("data-pulse", "false");
  });

  it("overflow lists the source and Restart, Discard, Hide pill, Mute mic", () => {
    const onRestart = vi.fn();
    const onHidePill = vi.fn();
    const onMuteToggle = vi.fn();
    renderHud({ onRestart, onHidePill, onMuteToggle, sourceLabel: "Studio Display" });
    openMenu();
    const menu = screen.getByRole("menu", { name: "Recording options" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId("hud-source")).toHaveTextContent("Studio Display");
    fireEvent.click(screen.getByRole("menuitem", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide pill" }));
    expect(onHidePill).toHaveBeenCalledOnce();
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute mic" }));
    expect(onMuteToggle).toHaveBeenCalledOnce();
  });

  it("actions without handlers are disabled", () => {
    renderHud();
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Restart" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Hide pill" })).toBeDisabled();
    expect(screen.getByRole("menuitemcheckbox", { name: "Mute mic" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("muted mic: struck-through mic, meter silent, menu item checked", () => {
    renderHud({ micMuted: true, micLevel: 0.9, onMuteToggle: vi.fn() });
    const meter = screen.getByTestId("mic-meter");
    expect(meter).toHaveAttribute("data-muted", "true");
    expect(meter).toHaveAttribute("aria-label", "Microphone muted");
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(0);
    expect(screen.getByTestId("mic-muted-icon")).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole("menuitemcheckbox", { name: "Mute mic" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Discard from the overflow confirms inline; confirming calls onDiscard", () => {
    const { onDiscard } = renderHud();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard…" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const confirm = screen.getByRole("alertdialog", { name: "Discard recording?" });
    expect(confirm).toHaveAttribute("data-testid", "hud-discard-confirm");
    expect(screen.queryByRole("dialog")).toBeNull();
    // The pill stays visible next to the confirm.
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Keep recording and Escape dismiss the confirm without discarding", () => {
    const { onDiscard } = renderHud({ phase: "paused" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard…" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard…" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("a controlled panel is reported, not stored locally", () => {
    const onPanelChange = vi.fn();
    renderHud({ openPanel: null, onPanelChange });
    openMenu();
    expect(onPanelChange).toHaveBeenCalledWith("menu");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the countdown value during the countdown phase", () => {
    renderHud({ phase: "countdown", countdownValue: 3 });
    expect(screen.getByTestId("countdown-value")).toHaveTextContent("3");
    expect(screen.getByTestId("recording-hud")).toHaveStyle({ width: "300px" });
    expect(screen.queryByRole("button", { name: "Stop recording" })).toBeNull();
  });

  it("renders the warning strip when a warning is set, and none otherwise", () => {
    const { unmount } = renderHud({ warning: "Disk space is running low" });
    expect(screen.getByTestId("hud-warning")).toHaveTextContent("Disk space is running low");
    unmount();
    renderHud({ warning: undefined });
    expect(screen.queryByTestId("hud-warning")).toBeNull();
  });

  it("lights meter bars proportional to micLevel; no input dims it", () => {
    const { unmount } = renderHud({ micLevel: 0.5 });
    expect(screen.getByTestId("mic-meter").querySelectorAll('[data-lit="true"]')).toHaveLength(4);
    unmount();
    renderHud({ micLevel: undefined });
    const meter = screen.getByTestId("mic-meter");
    expect(meter).toHaveAttribute("aria-disabled", "true");
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(0);
  });

  it("finalizing shows a processing status without recording controls", () => {
    renderHud({ phase: "finalizing", elapsedMs: 42_000 });
    expect(screen.getByTestId("hud-status")).toHaveTextContent("Processing recording…");
    expect(screen.getByTestId("hud-processing")).toHaveAttribute("data-motion", "full");
    expect(screen.queryByRole("button", { name: "Stop recording" })).toBeNull();
  });

  it("interrupted keeps the wide warning pill with what was saved and why", () => {
    renderHud({
      phase: "interrupted",
      elapsedMs: 42_000,
      interruptedMessage: "The display was disconnected",
    });
    expect(screen.getByTestId("recording-hud")).toHaveStyle({ width: "560px" });
    const status = screen.getByTestId("hud-status");
    expect(status).toHaveTextContent("Recording saved up to 00:42");
    expect(status).toHaveTextContent("The display was disconnected");
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More recording options" })).toBeNull();
  });
});
