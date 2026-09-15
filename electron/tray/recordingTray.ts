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
}

export const IDLE_TRAY_RECORDING: TrayRecording = { state: "idle", sessionId: null };

export function reduceTrayRecording(prev: TrayRecording, event: RecordingEvent): TrayRecording {
  // Events for another session never change what the tray controls.
  if (prev.sessionId !== null && event.sessionId !== prev.sessionId) return prev;
  switch (event.type) {
    case "started":
    case "resumed":
      return { state: "recording", sessionId: event.sessionId };
    case "paused":
      return { state: "paused", sessionId: event.sessionId };
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
