import { create } from "zustand";
import type { HudPhase, RecordingHudProps } from "../hud/types";
import {
  type CountdownState,
  IDLE_COUNTDOWN,
  cancelCountdown,
  countdownDisplayValue,
  countdownKey,
  startCountdown,
  tickCountdown,
} from "./countdown";
import type { RecordingError, RecordingEvent, RecordingPort } from "./port";
import { toRecordingError } from "./port";

/**
 * Recording session state for the HUD pill (§5.6 lifecycle, §5.7). Driven by
 * `recording:event` from main (timer comes from `stats`) plus renderer-local
 * mic level. Actions forward to main through the injected RecordingPort and,
 * for the Electron backend, to the renderer capture session.
 */

export type SessionPhase =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "finalizing"
  | "done"
  | "discarded"
  | "interrupted";

/** Renderer capture controls (satisfied by CaptureSession); absent for native backends. */
export interface CaptureControls {
  pause(): void;
  resume(): void;
  stop(): Promise<unknown>;
  discard(): Promise<void>;
}

export interface AttachOptions {
  capture?: CaptureControls | undefined;
  /** Fired once when the countdown reaches zero (main then starts writers). */
  onCountdownComplete?: (() => void) | undefined;
}

export interface RecordingSessionData {
  phase: SessionPhase;
  sessionId: string | null;
  elapsedMs: number;
  micLevel: number | undefined;
  warning: string | undefined;
  error: RecordingError | null;
  countdown: CountdownState;
}

export interface RecordingSessionState extends RecordingSessionData {
  attach: (port: RecordingPort, sessionId: string, opts?: AttachOptions | undefined) => void;
  detach: () => void;
  handleEvent: (event: RecordingEvent) => void;
  beginCountdown: (seconds: number, nowMs: number) => void;
  tickCountdown: (nowMs: number) => void;
  /** Keyboard input while the countdown overlay/HUD is focused (Esc cancels). */
  keyDown: (key: string) => void;
  cancelCountdown: () => void;
  setMicLevel: (level: number | undefined) => void;
  setWarning: (warning: string | undefined) => void;
  pauseToggle: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => Promise<void>;
  /** Finalize finished in main. */
  markDone: () => void;
  reset: () => void;
}

/** User-facing copy for warning reason codes (unknown codes pass through). */
export const WARNING_COPY: Record<string, string> = {
  diskLow: "Disk space is running low",
  deviceLost: "A capture device was disconnected",
  "system-audio-unsupported-macos": "System audio isn't available with this capture backend",
  "system-audio-unavailable": "System audio couldn't be captured",
  "cursor-not-hideable": "Cursor can't be hidden",
};

export function warningCopy(code: string): string {
  return WARNING_COPY[code] ?? code;
}

export function initialRecordingSession(): RecordingSessionData {
  return {
    phase: "idle",
    sessionId: null,
    elapsedMs: 0,
    micLevel: undefined,
    warning: undefined,
    error: null,
    countdown: IDLE_COUNTDOWN,
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function createRecordingSessionStore() {
  let port: RecordingPort | null = null;
  let capture: CaptureControls | undefined;
  let onCountdownComplete: (() => void) | undefined;
  let unsubscribe: (() => void) | null = null;

  return create<RecordingSessionState>((set, get) => {
    const fail = (err: unknown): void => set({ error: toRecordingError(err) });

    const applyCountdown = (next: CountdownState): void => {
      const prev = get().countdown;
      if (next === prev) return;
      if (next.status === "cancelled") {
        set({ countdown: next, phase: "idle" });
        const id = get().sessionId;
        const p = port;
        const c = capture;
        // Release any pre-acquired capture streams, then drop the session in main.
        void (async () => {
          try {
            if (c) await c.discard();
          } catch (err) {
            fail(err);
          }
          if (p && id) await p.discard(id).catch(fail);
        })();
        return;
      }
      set({ countdown: next });
      if (next.status === "done" && prev.status !== "done") onCountdownComplete?.();
    };

    const detach = (): void => {
      unsubscribe?.();
      unsubscribe = null;
      port = null;
      capture = undefined;
      onCountdownComplete = undefined;
    };

    return {
      ...initialRecordingSession(),

      attach: (p, sessionId, opts) => {
        detach();
        port = p;
        capture = opts?.capture;
        onCountdownComplete = opts?.onCountdownComplete;
        set({ ...initialRecordingSession(), sessionId });
        unsubscribe = p.subscribe((e) => get().handleEvent(e));
      },

      detach,

      handleEvent: (e) => {
        const s = get();
        if (e.sessionId !== s.sessionId) return;
        switch (e.type) {
          case "started":
            // A late `started` must not resurrect a finished/discarded session.
            if (s.phase === "idle" || s.phase === "countdown") {
              set({ phase: "recording", countdown: IDLE_COUNTDOWN });
            }
            break;
          case "paused":
            if (s.phase === "recording") set({ phase: "paused" });
            break;
          case "resumed":
            if (s.phase === "paused") set({ phase: "recording" });
            break;
          case "stats":
            if (e.elapsedMs !== undefined && Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0) {
              set({ elapsedMs: e.elapsedMs });
            }
            break;
          case "stopped":
            if (s.phase !== "discarded" && s.phase !== "done") {
              set({ phase: "finalizing", micLevel: undefined });
            }
            break;
          case "interrupted":
            // Stop renderer recorders so buffered chunks are flushed to disk and
            // devices are released; main keeps whatever was written (§5.6).
            if (capture && (s.phase === "recording" || s.phase === "paused")) {
              capture.stop().catch(() => {});
            }
            set({
              phase: "interrupted",
              micLevel: undefined,
              error: {
                code: e.reason ?? "interrupted",
                message: e.message ?? "Recording interrupted",
              },
            });
            break;
          case "diskLow":
          case "deviceLost":
            set({ warning: e.message ?? warningCopy(e.type) });
            break;
        }
      },

      beginCountdown: (seconds, nowMs) => {
        set({ phase: "countdown", countdown: IDLE_COUNTDOWN });
        applyCountdown(startCountdown(seconds, nowMs));
      },
      tickCountdown: (nowMs) => applyCountdown(tickCountdown(get().countdown, nowMs)),
      keyDown: (key) => applyCountdown(countdownKey(get().countdown, key)),
      cancelCountdown: () => applyCountdown(cancelCountdown(get().countdown)),

      setMicLevel: (level) =>
        set({
          micLevel: level === undefined || !Number.isFinite(level) ? undefined : clamp01(level),
        }),
      setWarning: (warning) => set({ warning }),

      pauseToggle: async () => {
        const { phase, sessionId } = get();
        if (!port || !sessionId) return;
        const c = capture;
        try {
          if (phase === "recording") {
            c?.pause();
            set({ phase: "paused" });
            await port.pause(sessionId);
          } else if (phase === "paused") {
            c?.resume();
            set({ phase: "recording" });
            await port.resume(sessionId);
          }
        } catch (err) {
          // Roll back both the phase and the renderer recorders.
          try {
            if (phase === "recording") c?.resume();
            else if (phase === "paused") c?.pause();
          } catch {
            // best effort
          }
          set({ phase });
          fail(err);
        }
      },

      stop: async () => {
        const { phase, sessionId } = get();
        if (!port || !sessionId || (phase !== "recording" && phase !== "paused")) return;
        const p = port;
        set({ phase: "finalizing", micLevel: undefined });
        // Flush every renderer chunk before main closes writers. Main is told to
        // stop even if the renderer side failed, so what reached disk is kept.
        try {
          if (capture) await capture.stop();
        } catch (err) {
          fail(err);
        }
        try {
          await p.stop(sessionId);
        } catch (err) {
          fail(err);
        }
      },

      discard: async () => {
        const { sessionId } = get();
        if (!port || !sessionId) return;
        const p = port;
        const c = capture;
        set({ phase: "discarded", micLevel: undefined, countdown: IDLE_COUNTDOWN });
        try {
          if (c) await c.discard();
          await p.discard(sessionId);
        } catch (err) {
          fail(err);
        } finally {
          detach();
        }
      },

      markDone: () => {
        if (get().phase === "finalizing") set({ phase: "done" });
      },

      reset: () => {
        detach();
        set(initialRecordingSession());
      },
    };
  });
}

export type RecordingSessionStore = ReturnType<typeof createRecordingSessionStore>;

/** App-wide recording session (one HUD per app). */
export const useRecordingSession: RecordingSessionStore = createRecordingSessionStore();

export function toHudPhase(phase: SessionPhase): HudPhase | null {
  return phase === "countdown" || phase === "recording" || phase === "paused" ? phase : null;
}

/** Props for `<RecordingHud>`; null when the session is not in a HUD phase. */
export function selectHudProps(
  state: RecordingSessionState,
  sourceLabel: string,
): RecordingHudProps | null {
  const phase = toHudPhase(state.phase);
  if (!phase) return null;
  return {
    phase,
    elapsedMs: state.elapsedMs,
    micLevel: state.micLevel,
    sourceLabel,
    warning: state.warning,
    countdownValue: countdownDisplayValue(state.countdown),
    onStop: () => {
      void state.stop();
    },
    onPauseToggle: () => {
      void state.pauseToggle();
    },
    onDiscard: () => {
      void state.discard();
    },
  };
}
