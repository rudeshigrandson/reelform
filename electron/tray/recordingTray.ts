import type { RecordingEvent } from "../recording/contracts";
import type { TrayRecordingState } from "./trayMenu";

/**
 * Tray view of the recording session (SPEC §11: red dot while recording; the
 * menu shows Pause/Resume and Stop only while a session is live). Pure: main
 * feeds every `recording:event` through {@link reduceTrayRecording}.
 */

export interface TrayRecording {
  state: TrayRecordingState;
  /** Session the tray's Pause/Resume/Stop act on; null when idle. */
  sessionId: string | null;
  /** Recorded time at the last start/pause/resume. */
  recordedMs: number;
  /** Wall clock (ms) when recording last (re)started; null unless recording. */
  runningSince: number | null;
}

export const IDLE_TRAY_RECORDING: TrayRecording = {
  state: "idle",
  sessionId: null,
  recordedMs: 0,
  runningSince: null,
};

export function reduceTrayRecording(
  prev: TrayRecording,
  event: RecordingEvent,
  now: number = Date.now(),
): TrayRecording {
  // Events for another session never change what the tray controls.
  if (prev.sessionId !== null && event.sessionId !== prev.sessionId) return prev;
  switch (event.type) {
    case "started":
      return { state: "recording", sessionId: event.sessionId, recordedMs: 0, runningSince: now };
    case "resumed":
      return {
        state: "recording",
        sessionId: event.sessionId,
        recordedMs: event.recordedMs,
        runningSince: now,
      };
    case "paused":
      return {
        state: "paused",
        sessionId: event.sessionId,
        recordedMs: event.recordedMs,
        runningSince: null,
      };
    case "stopped":
    case "interrupted":
    case "discarded":
    case "error":
      return IDLE_TRAY_RECORDING;
    default:
      // countdown, stats, diskLow, deviceLost: no tray change.
      return prev;
  }
}

/** Recorded time for the tray status row: frozen while paused, running while recording. */
export function trayElapsedMs(rec: TrayRecording, now: number = Date.now()): number {
  if (rec.state === "idle") return 0;
  return rec.recordedMs + (rec.runningSince === null ? 0 : Math.max(0, now - rec.runningSince));
}

/** Native menus can't animate, so the status row is rebuilt on this interval. */
export const TRAY_STATUS_INTERVAL_MS = 1000;

export interface TrayStatusTicker {
  /** Runs the timer only while `recording`; paused/idle rows are static. */
  sync(state: TrayRecordingState): void;
  running(): boolean;
  dispose(): void;
}

export function createTrayStatusTicker(
  onTick: () => void,
  intervalMs: number = TRAY_STATUS_INTERVAL_MS,
): TrayStatusTicker {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  return {
    sync(state) {
      if (state !== "recording") stop();
      else if (timer === null) timer = setInterval(onTick, intervalMs);
    },
    running: () => timer !== null,
    dispose: stop,
  };
}

export type TrayRecordingCommand = {
  channel: "recording:pause" | "recording:resume" | "recording:stop";
  sessionId: string;
} | null;

/** Which recording channel a tray menu action maps to, given the current session. */
export function trayActionCommand(
  action: "pause" | "resume" | "stop-recording",
  current: TrayRecording,
): TrayRecordingCommand {
  if (current.sessionId === null) return null;
  if (action === "pause") {
    return current.state === "recording"
      ? { channel: "recording:pause", sessionId: current.sessionId }
      : null;
  }
  if (action === "resume") {
    return current.state === "paused"
      ? { channel: "recording:resume", sessionId: current.sessionId }
      : null;
  }
  return { channel: "recording:stop", sessionId: current.sessionId };
}
