export type HudPhase = "countdown" | "recording" | "paused";

export interface RecordingHudProps {
  /** Current lifecycle phase of the HUD. */
  phase: HudPhase;
  /** Elapsed recording time in milliseconds. */
  elapsedMs: number;
  /** Mic input level, 0..1. Undefined = no/muted input. */
  micLevel?: number | undefined;
  /** Human label for the capture source, e.g. "Display 1". */
  sourceLabel: string;
  /** Optional warning text, e.g. "Cursor can't be hidden". */
  warning?: string | undefined;
  /** Number shown during the countdown phase, e.g. 3, 2, 1. */
  countdownValue?: number | undefined;
  /** Stop the recording. */
  onStop: () => void;
  /** Toggle pause/resume. */
  onPauseToggle: () => void;
  /** Discard the in-progress recording (after confirm). */
  onDiscard: () => void;
}

/** Sample props for previews and tests. */
export const sampleHudProps: RecordingHudProps = {
  phase: "recording",
  elapsedMs: 65_000,
  micLevel: 0.6,
  sourceLabel: "Display 1",
  warning: "Cursor can't be hidden",
  countdownValue: 3,
  onStop: () => {},
  onPauseToggle: () => {},
  onDiscard: () => {},
};
