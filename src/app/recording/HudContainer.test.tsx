import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakePort } from "../../recording/testFakes";
import { HudContainer } from "./HudContainer";
import { type RecordingBusMessage, createMemoryBusHub } from "./bus";
import { drain } from "./testFakes";

function setup(props: { sessionId?: string } = {}) {
  const port = new FakePort();
  const hub = createMemoryBusHub();
  const bus = hub.endpoint();
  const launcher = hub.endpoint();
  const launcherSeen: RecordingBusMessage[] = [];
  launcher.subscribe((m) => launcherSeen.push(m));
  const utils = render(<HudContainer port={port} bus={bus} {...props} />);
  const emit = async (e: Parameters<FakePort["emit"]>[0]) => {
    await act(async () => {
      port.emit(e);
    });
  };
  const post = async (m: RecordingBusMessage) => {
    await act(async () => {
      launcher.post(m);
      await drain();
    });
  };
  return { port, launcher, launcherSeen, emit, post, ...utils };
}

const stats = (elapsedMs: number) =>
  ({ sessionId: "s1", type: "stats", elapsedMs, fps: 60, droppedFrames: 0, fileBytes: 1 }) as const;

describe("HudContainer", () => {
  it("waits, asks the launcher for a snapshot, then adopts the session from events", async () => {
    const t = setup();
    expect(screen.getByTestId("hud-waiting")).toHaveTextContent("Waiting for recording…");
    await act(async () => drain());
    expect(t.launcherSeen).toEqual([{ type: "snapshotRequest" }]);

    await t.emit({ sessionId: "s1", type: "countdown", remaining: 3 });
    expect(screen.getByTestId("countdown-value")).toHaveTextContent("3");
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await t.emit(stats(4200));
    expect(screen.getByTestId("hud-timer")).toHaveTextContent("00:04");
    // Another session's events are ignored once adopted.
    await t.emit({ sessionId: "s2", type: "paused", elapsedMs: 0 });
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });

  it("adopts from a bus snapshot mid-recording with the source label", async () => {
    const t = setup();
    await t.post({
      type: "snapshot",
      snapshot: {
        sessionId: "s1",
        phase: "paused",
        countdownRemaining: null,
        countdownTotal: null,
        sourceLabel: "Studio Display",
        displayId: "d1",
        webcamDeviceId: null,
      },
    });
    expect(screen.getByTestId("hud-source")).toHaveTextContent("Studio Display");
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
  });

  it("pause, stop and confirmed discard go to main", async () => {
    const t = setup({ sessionId: "s1" });
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    await act(async () => drain());
    expect(t.port.calls).toEqual(["pause:s1"]);
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    await act(async () => drain());

    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(t.port.calls).toEqual(["pause:s1", "resume:s1"]);

    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await act(async () => drain());
    expect(t.port.calls).toContain("stop:s1");
    expect(screen.getByTestId("hud-status")).toHaveTextContent("Processing recording…");
  });

  it("discard after confirm", async () => {
    const t = setup({ sessionId: "s1" });
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await act(async () => drain());
    expect(t.port.calls).toEqual(["discard:s1"]);
    expect(screen.getByTestId("hud-waiting")).toHaveTextContent("Recording discarded");
  });

  it("mic meter from the launcher's renderer meter; zero while paused", async () => {
    const t = setup({ sessionId: "s1" });
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await t.post({ type: "micLevel", sessionId: "s1", level: 0.5 });
    const meter = screen.getByTestId("mic-meter");
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(6);
    await t.post({ type: "micLevel", sessionId: "other", level: 1 });
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(6);
  });

  it("disk low and capture warnings show in the pill", async () => {
    const t = setup({ sessionId: "s1" });
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await t.emit({ sessionId: "s1", type: "diskLow", freeBytes: 100 });
    expect(screen.getByTestId("hud-warning")).toHaveTextContent("Disk space is running low");
    await t.post({ type: "warning", sessionId: "s1", code: "system-audio-unsupported-macos" });
    expect(screen.getByTestId("hud-warning")).toHaveTextContent(
      "System audio isn't available with this capture backend",
    );
  });

  it("interrupted: warning pill with what was saved", async () => {
    const t = setup({ sessionId: "s1" });
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await t.emit({
      sessionId: "s1",
      type: "interrupted",
      reason: "displayDisconnected",
      elapsedMs: 42_000,
    });
    expect(screen.getByTestId("recording-hud")).toHaveAttribute("data-phase", "interrupted");
    expect(screen.getByTestId("hud-status")).toHaveTextContent(
      "Recording saved up to 00:42 — The display was disconnected",
    );
  });

  it("unmount unsubscribes from main and the bus", async () => {
    const t = setup({ sessionId: "s1" });
    t.unmount();
    expect(t.port.listeners.size).toBe(0);
  });
});
