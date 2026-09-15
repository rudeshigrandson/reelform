import type { CaptureControls } from "./sessionStore";
import {
  createRecordingSessionStore,
  initialRecordingSession,
  interruptCopy,
  selectHudProps,
  toHudPhase,
  useRecordingSession,
  warningCopy,
} from "./sessionStore";
import { FakePort, drain } from "./testFakes";

function fakeCapture(order: string[]): CaptureControls {
  return {
    pause: () => order.push("capture.pause"),
    resume: () => order.push("capture.resume"),
    stop: async () => {
      await drain();
      order.push("capture.stop");
    },
    discard: async () => {
      order.push("capture.discard");
    },
  };
}

function setup() {
  const store = createRecordingSessionStore();
  const port = new FakePort();
  const order: string[] = [];
  const origStop = port.stop.bind(port);
  port.stop = (id) => {
    order.push("port.stop");
    return origStop(id);
  };
  return { store, port, order };
}

describe("recording session store", () => {
  it("exports an app-wide instance with idle defaults", () => {
    expect(useRecordingSession.getState()).toMatchObject(initialRecordingSession());
  });

  it("follows main events for the attached session only", () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    expect(store.getState().phase).toBe("recording");
    port.emit({ sessionId: "other", type: "paused", elapsedMs: 1 });
    expect(store.getState().phase).toBe("recording");
    const stats = { fps: 60, droppedFrames: 0, fileBytes: 10 };
    port.emit({ sessionId: "s1", type: "stats", elapsedMs: 4200, ...stats });
    expect(store.getState().elapsedMs).toBe(4200);
    port.emit({ sessionId: "s1", type: "stats", elapsedMs: Number.NaN, ...stats });
    port.emit({ sessionId: "s1", type: "stats", elapsedMs: -1, ...stats });
    expect(store.getState().elapsedMs).toBe(4200);
    port.emit({ sessionId: "s1", type: "stats", elapsedMs: 4300, micLevel: 0.25, ...stats });
    expect(store.getState().micLevel).toBe(0.25);
    port.emit({ sessionId: "s1", type: "paused", elapsedMs: 4400 });
    expect(store.getState()).toMatchObject({ phase: "paused", elapsedMs: 4400 });
    port.emit({ sessionId: "s1", type: "resumed", elapsedMs: 4400 });
    expect(store.getState().phase).toBe("recording");
    port.emit({ sessionId: "s1", type: "diskLow", freeBytes: 1 });
    expect(store.getState().warning).toBe("Disk space is running low");
    port.emit({ sessionId: "s1", type: "deviceLost", device: "Shure MV7" });
    expect(store.getState().warning).toBe("A capture device was disconnected (Shure MV7)");
    port.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5000, reason: "user" });
    expect(store.getState()).toMatchObject({ phase: "finalizing", elapsedMs: 5000 });
    store.getState().markDone();
    expect(store.getState().phase).toBe("done");
  });

  it("interrupted sets phase and a stable error", () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    store.getState().setMicLevel(0.4);
    port.emit({
      sessionId: "s1",
      type: "interrupted",
      reason: "displayDisconnected",
      elapsedMs: 42_000,
    });
    expect(store.getState()).toMatchObject({
      phase: "interrupted",
      micLevel: undefined,
      elapsedMs: 42_000,
      error: { code: "displayDisconnected", message: "The display was disconnected" },
    });
    expect(selectHudProps(store.getState(), "Display 1")).toMatchObject({
      phase: "interrupted",
      elapsedMs: 42_000,
      interruptedMessage: "The display was disconnected",
    });
  });

  it("re-attaching unsubscribes the previous port and resets state", () => {
    const { store, port } = setup();
    const port2 = new FakePort();
    store.getState().attach(port, "s1");
    port.emit({
      sessionId: "s1",
      type: "stats",
      elapsedMs: 9,
      fps: 1,
      droppedFrames: 0,
      fileBytes: 0,
    });
    store.getState().attach(port2, "s2");
    expect(port.listeners.size).toBe(0);
    expect(store.getState()).toMatchObject({ sessionId: "s2", elapsedMs: 0 });
    store.getState().reset();
    expect(port2.listeners.size).toBe(0);
    expect(store.getState().sessionId).toBeNull();
  });

  it("countdown ticks, fires completion once, and stays in countdown until started", () => {
    const { store, port } = setup();
    const onCountdownComplete = vi.fn();
    store.getState().attach(port, "s1", { onCountdownComplete });
    store.getState().beginCountdown(3, 0);
    expect(store.getState().phase).toBe("countdown");
    expect(selectHudProps(store.getState(), "Display 1")?.countdownValue).toBe(3);
    store.getState().tickCountdown(1500);
    expect(selectHudProps(store.getState(), "Display 1")?.countdownValue).toBe(2);
    store.getState().tickCountdown(3000);
    store.getState().tickCountdown(4000);
    expect(onCountdownComplete).toHaveBeenCalledTimes(1);
    expect(store.getState().phase).toBe("countdown");
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    expect(store.getState().phase).toBe("recording");
    expect(selectHudProps(store.getState(), "x")?.countdownValue).toBeUndefined();
  });

  it("countdown of 0 completes immediately", () => {
    const { store, port } = setup();
    const onCountdownComplete = vi.fn();
    store.getState().attach(port, "s1", { onCountdownComplete });
    store.getState().beginCountdown(0, 10);
    expect(onCountdownComplete).toHaveBeenCalledTimes(1);
  });

  it("Esc cancels the countdown, returns to idle and discards the session", async () => {
    const { store, port } = setup();
    const onCountdownComplete = vi.fn();
    store.getState().attach(port, "s1", { onCountdownComplete });
    store.getState().beginCountdown(5, 0);
    store.getState().keyDown("a");
    expect(store.getState().phase).toBe("countdown");
    store.getState().keyDown("Escape");
    expect(store.getState().phase).toBe("idle");
    await drain();
    expect(port.calls).toEqual(["discard:s1"]);
    store.getState().tickCountdown(10_000);
    expect(onCountdownComplete).not.toHaveBeenCalled();
  });

  it("pauseToggle pauses capture before main, then resumes", async () => {
    const { store, port, order } = setup();
    store.getState().attach(port, "s1", { capture: fakeCapture(order) });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await store.getState().pauseToggle();
    expect(store.getState().phase).toBe("paused");
    await store.getState().pauseToggle();
    expect(store.getState().phase).toBe("recording");
    expect(order).toEqual(["capture.pause", "capture.resume"]);
    expect(port.calls).toEqual(["pause:s1", "resume:s1"]);
  });

  it("pauseToggle rolls back the phase and records the error when main fails", async () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    port.failNext = "pause";
    await store.getState().pauseToggle();
    expect(store.getState().phase).toBe("recording");
    expect(store.getState().error).toEqual({ code: "pause-failed", message: "pause failed" });
  });

  it("pauseToggle / stop are no-ops when not attached or not recording", async () => {
    const { store, port } = setup();
    await store.getState().pauseToggle();
    await store.getState().stop();
    store.getState().attach(port, "s1");
    await store.getState().stop(); // idle
    expect(port.calls).toEqual([]);
  });

  it("stop flushes renderer capture before telling main to stop", async () => {
    const { store, port, order } = setup();
    store.getState().attach(port, "s1", { capture: fakeCapture(order) });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    store.getState().setMicLevel(0.7);
    await store.getState().stop();
    expect(order).toEqual(["capture.stop", "port.stop"]);
    expect(store.getState()).toMatchObject({ phase: "finalizing", micLevel: undefined });
  });

  it("discard stops capture, tells main, and detaches", async () => {
    const { store, port, order } = setup();
    store.getState().attach(port, "s1", { capture: fakeCapture(order) });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await store.getState().discard();
    expect(order).toEqual(["capture.discard"]);
    expect(port.calls).toEqual(["discard:s1"]);
    expect(store.getState().phase).toBe("discarded");
    expect(port.listeners.size).toBe(0);
  });

  it("Esc during countdown also discards pre-acquired capture", async () => {
    const { store, port, order } = setup();
    store.getState().attach(port, "s1", { capture: fakeCapture(order) });
    store.getState().beginCountdown(3, 0);
    store.getState().keyDown("Esc");
    await drain();
    expect(order).toEqual(["capture.discard"]);
    expect(port.calls).toEqual(["discard:s1"]);
  });

  it("a late started event does not resurrect a discarded or finalizing session", async () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    port.emit({ sessionId: "s1", type: "stopped", elapsedMs: 1, reason: "user" });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    expect(store.getState().phase).toBe("finalizing");
  });

  it("interrupted stops renderer capture so buffered chunks reach disk", async () => {
    const { store, port, order } = setup();
    store.getState().attach(port, "s1", { capture: fakeCapture(order) });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    port.emit({ sessionId: "s1", type: "interrupted", reason: "diskLow", elapsedMs: 1 });
    await drain(20);
    expect(order).toEqual(["capture.stop"]);
    expect(store.getState().phase).toBe("interrupted");
  });

  it("pauseToggle failure also rolls back renderer capture", async () => {
    const { store, port, order } = setup();
    store.getState().attach(port, "s1", { capture: fakeCapture(order) });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    port.failNext = "pause";
    await store.getState().pauseToggle();
    expect(order).toEqual(["capture.pause", "capture.resume"]);
    expect(store.getState().phase).toBe("recording");
  });

  it("stop still tells main to stop when renderer capture fails", async () => {
    const { store, port, order } = setup();
    const capture = fakeCapture(order);
    capture.stop = async () => {
      throw { code: "flush-failed", message: "x" };
    };
    store.getState().attach(port, "s1", { capture });
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await store.getState().stop();
    expect(order).toEqual(["port.stop"]);
    expect(store.getState()).toMatchObject({
      phase: "finalizing",
      error: { code: "flush-failed", message: "x" },
    });
  });

  it("setMicLevel clamps and clears on non-finite", () => {
    const { store } = setup();
    store.getState().setMicLevel(1.5);
    expect(store.getState().micLevel).toBe(1);
    store.getState().setMicLevel(-2);
    expect(store.getState().micLevel).toBe(0);
    store.getState().setMicLevel(Number.NaN);
    expect(store.getState().micLevel).toBeUndefined();
  });

  it("selectHudProps maps state and wires actions; null outside HUD phases", async () => {
    const { store, port } = setup();
    expect(selectHudProps(store.getState(), "Display 1")).toBeNull();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    port.emit({
      sessionId: "s1",
      type: "stats",
      elapsedMs: 65_000,
      fps: 60,
      droppedFrames: 0,
      fileBytes: 1,
    });
    store.getState().setMicLevel(0.6);
    store.getState().setWarning(warningCopy("cursor-not-hideable"));
    const props = selectHudProps(store.getState(), "Display 1");
    expect(props).toMatchObject({
      phase: "recording",
      elapsedMs: 65_000,
      micLevel: 0.6,
      sourceLabel: "Display 1",
      warning: "Cursor can't be hidden",
      countdownValue: undefined,
    });
    props?.onPauseToggle();
    await drain();
    expect(store.getState().phase).toBe("paused");
    props?.onStop();
    await drain();
    expect(port.calls).toContain("stop:s1");
    expect(selectHudProps(store.getState(), "Display 1")?.phase).toBe("finalizing");
    store.getState().markDone();
    expect(selectHudProps(store.getState(), "Display 1")).toBeNull();
  });

  it("toHudPhase / warningCopy", () => {
    expect(toHudPhase("paused")).toBe("paused");
    expect(toHudPhase("finalizing")).toBe("finalizing");
    expect(toHudPhase("interrupted")).toBe("interrupted");
    expect(toHudPhase("done")).toBeNull();
    expect(toHudPhase("idle")).toBeNull();
    expect(interruptCopy("helperCrash")).toBe("The capture helper stopped unexpectedly");
    expect(interruptCopy("bogus")).toBe("Recording was interrupted");
    expect(warningCopy("unknown-code")).toBe("unknown-code");
  });

  it("main countdown events drive the countdown numeral without a local clock", () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "countdown", remaining: 3 });
    expect(store.getState().phase).toBe("countdown");
    expect(selectHudProps(store.getState(), "x")?.countdownValue).toBe(3);
    port.emit({ sessionId: "s1", type: "countdown", remaining: 2 });
    expect(selectHudProps(store.getState(), "x")?.countdownValue).toBe(2);
    expect(store.getState().countdown.totalMs).toBe(3000);
    port.emit({ sessionId: "s1", type: "countdown", remaining: 0 });
    expect(selectHudProps(store.getState(), "x")?.countdownValue).toBe(2);
    port.emit({ sessionId: "s1", type: "started", backend: "electron" });
    expect(store.getState().phase).toBe("recording");
    port.emit({ sessionId: "s1", type: "countdown", remaining: 1 }); // late: ignored
    expect(store.getState().phase).toBe("recording");
  });

  it("Esc on a main-driven countdown discards the session in main", async () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "countdown", remaining: 5 });
    store.getState().keyDown("Escape");
    await drain();
    expect(port.calls).toEqual(["discard:s1"]);
    expect(store.getState().phase).toBe("idle");
  });

  it("discarded and error events from main", () => {
    const { store, port } = setup();
    store.getState().attach(port, "s1");
    port.emit({ sessionId: "s1", type: "countdown", remaining: 3 });
    port.emit({ sessionId: "s1", type: "error", code: "START_FAILED", message: "helper died" });
    expect(store.getState()).toMatchObject({
      phase: "idle",
      error: { code: "START_FAILED", message: "helper died" },
    });
    store.getState().attach(port, "s2");
    port.emit({ sessionId: "s2", type: "started", backend: "sck" });
    port.emit({ sessionId: "s2", type: "discarded" });
    expect(store.getState().phase).toBe("discarded");
    port.emit({ sessionId: "s2", type: "error", code: "X", message: "late" });
    expect(store.getState().phase).toBe("discarded");
  });
});
