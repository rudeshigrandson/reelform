import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RecordingEvent } from "../recording/contracts";
import {
  IDLE_TRAY_RECORDING,
  type TrayRecording,
  reduceTrayRecording,
  trayActionCommand,
} from "./recordingTray";

const ev = (e: Record<string, unknown>) => e as unknown as RecordingEvent;

describe("reduceTrayRecording", () => {
  it("follows a session through start, pause, resume and stop", () => {
    let s: TrayRecording = IDLE_TRAY_RECORDING;
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "countdown", secondsLeft: 3 }));
    expect(s).toEqual(IDLE_TRAY_RECORDING);
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "started", backend: "electron" }));
    expect(s).toEqual({ state: "recording", sessionId: "a" });
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "stats", elapsedMs: 1000 }));
    expect(s.state).toBe("recording");
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "paused", recordedMs: 1000 }));
    expect(s).toEqual({ state: "paused", sessionId: "a" });
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "resumed", recordedMs: 1000 }));
    expect(s.state).toBe("recording");
    s = reduceTrayRecording(s, ev({ sessionId: "a", type: "stopped" }));
    expect(s).toEqual(IDLE_TRAY_RECORDING);
  });

  it("returns to idle on interrupted, discarded and error", () => {
    for (const type of ["interrupted", "discarded", "error"]) {
      const live: TrayRecording = { state: "recording", sessionId: "a" };
      expect(reduceTrayRecording(live, ev({ sessionId: "a", type }))).toEqual(IDLE_TRAY_RECORDING);
    }
  });

  it("ignores events from other sessions while one is live", () => {
    const live: TrayRecording = { state: "paused", sessionId: "a" };
    expect(reduceTrayRecording(live, ev({ sessionId: "b", type: "stopped" }))).toBe(live);
    expect(reduceTrayRecording(live, ev({ sessionId: "b", type: "started" }))).toBe(live);
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
    const rec: TrayRecording = { state: "recording", sessionId: "s1" };
    const paused: TrayRecording = { state: "paused", sessionId: "s1" };
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
    expect(trayActionCommand("pause", { state: "paused", sessionId: "s1" })).toBeNull();
    expect(trayActionCommand("resume", { state: "recording", sessionId: "s1" })).toBeNull();
  });
});
