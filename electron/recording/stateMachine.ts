/**
 * Recording session state machine (ENGINEERING_SPEC §5.6). Pure.
 *
 *   idle → preparing → countdown → recording ⇄ paused → finalizing → done
 *                                                     ↘ discarded | interrupted
 *
 * `interrupted` keeps everything written; it may still be finalized (to open
 * the post-record dialog) or explicitly discarded by the user.
 */

export type RecordingState =
  | "idle"
  | "preparing"
  | "countdown"
  | "recording"
  | "paused"
  | "finalizing"
  | "done"
  | "discarded"
  | "interrupted";

export type RecordingAction =
  | "prepare"
  | "prepareFailed"
  | "prepared"
  | "countdownDone"
  | "startFailed"
  | "pause"
  | "resume"
  | "stop"
  | "finalized"
  | "discard"
  | "interrupt";

const TABLE: Record<RecordingState, Partial<Record<RecordingAction, RecordingState>>> = {
  idle: { prepare: "preparing" },
  preparing: { prepareFailed: "idle", prepared: "countdown", discard: "discarded" },
  countdown: { countdownDone: "recording", startFailed: "idle", discard: "discarded" },
  recording: {
    pause: "paused",
    stop: "finalizing",
    discard: "discarded",
    interrupt: "interrupted",
  },
  paused: {
    resume: "recording",
    stop: "finalizing",
    discard: "discarded",
    interrupt: "interrupted",
  },
  finalizing: { finalized: "done", discard: "discarded", interrupt: "interrupted" },
  done: {},
  discarded: {},
  interrupted: { discard: "discarded" },
};

export const TERMINAL_STATES: readonly RecordingState[] = ["done", "discarded", "interrupted"];

/** Next state, or `null` when the action is illegal in `state`. */
export function transition(state: RecordingState, action: RecordingAction): RecordingState | null {
  return TABLE[state][action] ?? null;
}

export function canTransition(state: RecordingState, action: RecordingAction): boolean {
  return transition(state, action) !== null;
}

/** A session in any of these states blocks starting another one. */
export function isActive(state: RecordingState): boolean {
  return state !== "idle" && !TERMINAL_STATES.includes(state);
}

/** States in which the capture pipeline may still be writing media. */
export function isCapturing(state: RecordingState): boolean {
  return state === "recording" || state === "paused";
}
