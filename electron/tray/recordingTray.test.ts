import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingEvent } from "../recording/contracts";
import {
  IDLE_TRAY_RECORDING,
  TRAY_STATUS_INTERVAL_MS,
  type TrayRecording,
  createTrayStatusTicker,
  reduceTrayRecording,
  trayActionCommand,
  trayElapsedMs,
} from "./recordingTray";

const live = (state: "recording" | "paused", sessionId: string): TrayRecording => ({
  state,
  sessionId,
  recordedMs: 0,
  runningSince: null,
});

const ev = (e: Record<string, unknown>) => e as unknown as RecordingEvent;

describe("reduceTrayRecording", () => {
  it("follows a session through start, pause, resume and stop", () => {
    let s: TrayRecording = IDLE_TRAY_RECORDING;
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "countdown", secondsLeft: 3 }));
    expect(s).toEqual(IDLE_TRAY_RECORDING);
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "started", backend: "electron" }), 10);
    expect(s).toEqual({ state: "recording", sessionId: "a", recordedMs: 0, runningSince: 10 });
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "stats", elapsedMs: 1000 }));
    expect(s.state).toBe("recording");
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "paused", recordedMs: 1000 }));
    expect(s).toEqual({ state: "paused", sessionId: "a", recordedMs: 1000, runningSince: null });
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "resumed", recordedMs: 1000 }));
    expect(s.state).toBe("recording");
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "stopped" }));
    expect(s).toEqual(IDLE_TRAY_RECORDING);
  });

  it("returns to idle on interrupted, discarded and error", () => {
    for (const type of ["interrupted", "discarded", "error"]) {
      const rec = live("recording", "a");
      expect(reduceTrayRecording(rec, ev({ sessionId: "a", type }))).toEqual(IDLE_TRAY_RECORDING);
    }
  });

  it("ignores events from other sessions while one is live", () => {
    const paused = live("paused", "a");
    expect(reduceTrayRecording(paused, ev({ sessionId: "b", type: "stopped" }))).toBe(paused);
    expect(reduceTrayRecording(paused, ev({ sessionId: "b", type: "started" }))).toBe(paused);
  });

  it("property: state and session id are always consistent", () => {
    const types = [
      "countdown",
      "started",
      "paused",
      "resumed",
      "stats",
      "stopped",
      "interrupted",
      "diskLow",
      "deviceLost",
      "discarded",
      "error",
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ sessionId: fc.constantFrom("a", "b"), type: fc.constantFrom(...types) }),
        ),
        (events) => {
          let s: TrayRecording = IDLE_TRAY_RECORDING;
          for (const e of events) s = reduceTrayRecording(s, ev(e));
          expect(s.state === "idle").toBe(s.sessionId === null);
        },
      ),
    );
  });
});

describe("trayActionCommand", () => {
  it("maps menu actions to recording channels for the live session", () => {
    const rec = live("recording", "s1");
    const paused = live("paused", "s1");
    expect(trayActionCommand("pause", rec)).toEqual({
      channel: "recording:pause",
      sessionId: "s1",
    });
    expect(trayActionCommand("resume", paused)).toEqual({
      channel: "recording:resume",
      sessionId: "s1",
    });
    expect(trayActionCommand("stop-recording", paused)).toEqual({
      channel: "recording:stop",
      sessionId: "s1",
    });
  });

  it("does nothing when idle or when the action doesn't fit the state", () => {
    expect(trayActionCommand("stop-recording", IDLE_TRAY_RECORDING)).toBeNull();
    expect(trayActionCommand("pause", live("paused", "s1"))).toBeNull();
    expect(trayActionCommand("resume", live("recording", "s1"))).toBeNull();
  });
});

describe("trayElapsedMs", () => {
  it("runs while recording, freezes while paused, continues after resume", () => {
    let s = reduceTrayRecording(IDLE_TRAY_RECORDING, ev({ sessionId: "a", type: "started" }), 1000);
    expect(trayElapsedMs(s, 1000)).toBe(0);
    expect(trayElapsedMs(s, 43_100)).toBe(42_100);
    // Stats don't rebuild the tray state.
    expect(reduceTrayRecording(s, ev({ sessionId: "a", type: "stats", recordedMs: 5 }), 2000)).toBe(
      s,
    );
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "paused", recordedMs: 42_100 }), 43_100);
    expect(trayElapsedMs(s, 99_000)).toBe(42_100);
    s = reduceTrayRecording(
      s,
      ev({ sessionId: "a", type: "resumed", recordedMs: 42_100 }),
      100_000,
    );
    expect(trayElapsedMs(s, 101_500)).toBe(43_600);
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "stopped", recordedMs: 43_600 }));
    expect(trayElapsedMs(s, 200_000)).toBe(0);
  });

  it("never goes negative when the clock steps back", () => {
    const s = reduceTrayRecording(
      IDLE_TRAY_RECORDING,
      ev({ sessionId: "a", type: "started" }),
      5000,
    );
    expect(trayElapsedMs(s, 4000)).toBe(0);
  });
});

describe("createTrayStatusTicker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks once per interval only while recording and clears the timer otherwise", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const ticker = createTrayStatusTicker(onTick);
    ticker.sync("idle");
    expect(vi.getTimerCount()).toBe(0);

    ticker.sync("recording");
    ticker.sync("recording"); // idempotent: still one timer
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(TRAY_STATUS_INTERVAL_MS * 3);
    expect(onTick).toHaveBeenCalledTimes(3);

    ticker.sync("paused");
    expect(ticker.running()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TRAY_STATUS_INTERVAL_MS * 5);
    expect(onTick).toHaveBeenCalledTimes(3);

    ticker.sync("recording");
    vi.advanceTimersByTime(TRAY_STATUS_INTERVAL_MS);
    expect(onTick).toHaveBeenCalledTimes(4);
    ticker.sync("idle");
    expect(vi.getTimerCount()).toBe(0);

    ticker.sync("recording");
    ticker.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
