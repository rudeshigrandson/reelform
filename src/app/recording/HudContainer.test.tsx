import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakePort } from "../../recording/testFakes";
import { HudContainer } from "./HudContainer";
import { type RecordingBusMessage, createMemoryBusHub } from "./bus";
import { createRecordingFlow } from "./flow";
import {
  FakeAppPort,
  FakeProjects,
  FakeSystem,
  FakeWindows,
  SOURCES,
  drain,
  fakeCaptureFactory,
  fakePreRecordDeps,
} from "./testFakes";

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

// ---- global shortcuts, pre-record pill, hidden mode ------------------------------------

function fakeShortcuts() {
  const listeners = new Set<(id: string) => void>();
  return {
    listeners,
    subscribe: (l: (id: string) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fire: async (id: string) => {
      await act(async () => {
        for (const l of [...listeners]) l(id);
        await drain();
      });
    },
  };
}

function shortcutSetup(opts: { focused?: () => Element | null } = {}) {
  const port = new FakePort();
  const shortcuts = fakeShortcuts();
  const utils = render(
    <HudContainer
      port={port}
      sessionId="s1"
      preRecord={null}
      onShortcut={shortcuts.subscribe}
      activeElement={opts.focused}
    />,
  );
  const emit = async (e: Parameters<FakePort["emit"]>[0]) => {
    await act(async () => {
      port.emit(e);
    });
  };
  return { port, shortcuts, emit, ...utils };
}

describe("HudContainer — global shortcuts", () => {
  it("record.pause toggles, record.toggle stops", async () => {
    const t = shortcutSetup();
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await t.shortcuts.fire("record.pause");
    expect(t.port.calls).toEqual(["pause:s1"]);
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
    await t.shortcuts.fire("record.pause");
    await t.shortcuts.fire("record.toggle");
    expect(t.port.calls).toEqual(["pause:s1", "resume:s1", "stop:s1"]);
  });

  it("Esc during the countdown discards; ignored once recording", async () => {
    const t = shortcutSetup();
    await t.emit({ sessionId: "s1", type: "countdown", remaining: 3 });
    await t.shortcuts.fire("record.toggle"); // no stop during countdown
    expect(t.port.calls).toEqual([]);
    await t.shortcuts.fire("record.cancelCountdown");
    expect(t.port.calls).toEqual(["discard:s1"]);

    const r = shortcutSetup();
    await r.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await r.shortcuts.fire("record.cancelCountdown");
    expect(r.port.calls).toEqual([]);
  });

  it("ignores shortcuts while typing in a text field", async () => {
    const input = document.createElement("input");
    const t = shortcutSetup({ focused: () => input });
    await t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await t.shortcuts.fire("record.toggle");
    await t.shortcuts.fire("record.pause");
    expect(t.port.calls).toEqual([]);
  });

  it("unsubscribes on unmount", () => {
    const t = shortcutSetup();
    expect(t.shortcuts.listeners.size).toBe(1);
    t.unmount();
    expect(t.shortcuts.listeners.size).toBe(0);
  });
});

describe("HudContainer — pre-record pill driven by the launcher flow", () => {
  function flowSetup() {
    const log: string[] = [];
    const port = new FakeAppPort();
    const hub = createMemoryBusHub();
    const flow = createRecordingFlow({
      port,
      windows: new FakeWindows(),
      projects: new FakeProjects(),
      system: new FakeSystem(),
      startCapture: fakeCaptureFactory(log).startCapture,
      platform: "linux",
      appVersion: "1.0.0",
      newId: () => "p1",
      nowIso: () => "2026-09-15T14:32:05.000Z",
      openEditorAfterRecording: () => false,
      sources: () => SOURCES,
      bus: hub.endpoint(),
    });
    const pre = fakePreRecordDeps({ platform: "linux" });
    const shortcuts = fakeShortcuts();
    const utils = render(
      <HudContainer
        port={port}
        bus={hub.endpoint()}
        preRecord={pre.deps}
        onShortcut={shortcuts.subscribe}
      />,
    );
    const flush = async () => {
      await act(async () => {
        await drain(60);
      });
    };
    return { port, flow, pre, shortcuts, flush, ...utils };
  }

  it("Record in the pill starts the flow; the HUD adopts the session into the live pill", async () => {
    const t = flowSetup();
    await t.flush();
    expect(screen.getByTestId("pre-record-hud")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await t.flush();
    expect(t.port.lastStart).toMatchObject({ source: { kind: "display", id: "d1" }, countdown: 3 });
    expect(t.flow.store.getState().phase).toBe("countdown");

    await act(async () => {
      t.port.emit({ sessionId: "s1", type: "started", backend: "electron" });
      await drain(60);
    });
    expect(screen.queryByTestId("pre-record-hud")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    // Leaving pre-record collapses the grown window.
    expect(t.pre.windows.calls.at(-1)).toBe("collapse");
    t.flow.dispose();
  });

  it("record.toggle starts from the pre-record pill", async () => {
    const t = flowSetup();
    await t.flush();
    await t.shortcuts.fire("record.toggle");
    await t.flush();
    expect(t.port.calls).toContain("start");
    t.flow.dispose();
  });

  it("Hide HUD while recording shows only a red dot that restores the pill", async () => {
    const t = flowSetup();
    await t.flush();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hide HUD while recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await t.flush();
    await act(async () => {
      t.port.emit({ sessionId: "s1", type: "started", backend: "electron" });
      await drain(60);
    });
    const dot = screen.getByRole("button", { name: "Show recording controls" });
    expect(screen.queryByRole("button", { name: "Stop recording" })).toBeNull();
    // Shortcuts still work while hidden.
    await t.shortcuts.fire("record.pause");
    expect(t.port.calls).toContain("pause:s1");
    fireEvent.click(dot);
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeInTheDocument();
    t.flow.dispose();
  });

  it("outside Electron (no deps) keeps the waiting state", () => {
    render(<HudContainer port={new FakePort()} />);
    expect(screen.getByTestId("hud-waiting")).toBeInTheDocument();
  });
});
