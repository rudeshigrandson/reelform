import type { RecordingPanel } from "./layout";

/**
 * `finalizing`: "Processing recording…" after stop. `interrupted`: warning pill
 * "Recording saved up to 00:42" (guide S10/S11).
 */
export type HudPhase = "countdown" | "recording" | "paused" | "finalizing" | "interrupted";

export interface RecordingHudProps {
  /** Current lifecycle phase of the HUD. */
  phase: HudPhase;
  /** Elapsed recording time in milliseconds. */
  elapsedMs: number;
  /** Mic input level, 0..1. Undefined = no/muted input. */
  micLevel?: number | undefined;
  /** Human label for the capture source, e.g. "Display 1". */
  sourceLabel: string;
  /** `interrupted`: why capture stopped, e.g. "The display was disconnected". */
  interruptedMessage?: string | undefined;
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
  /** Overflow "Restart": discard, then start again with the same setup. Absent = not offered. */
  onRestart?: (() => void) | undefined;
  /** Overflow "Hide pill": collapse to the hidden-mode dot. */
  onHidePill?: (() => void) | undefined;
  /** The mic is muted from the pill (struck-through mic, warning tint). */
  micMuted?: boolean | undefined;
  /** Overflow "Mute mic" toggle. Absent = not offered. */
  onMuteToggle?: (() => void) | undefined;
  /** Open overflow menu / discard confirm; controlled so the container can grow the window first. */
  openPanel?: RecordingPanel | null | undefined;
  onPanelChange?: ((panel: RecordingPanel | null) => void) | undefined;
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

// ---- Pre-record pill (guide S05) ------------------------------------------------

export type PreRecordMode = "screen" | "window" | "region";

/** A chip above the pill: fallback capture, device errors, start failures. */
export interface HudChip {
  id: string;
  tone: "warning" | "danger";
  message: string;
}

export interface HudDevice {
  id: string;
  label: string;
}

/** Overflow options (countdown, cursor, fps, hide HUD while recording). */
export interface PreRecordOptions {
  countdown: 0 | 3 | 5 | 10;
  hideCursor: boolean;
  fps: 30 | 60;
  hideHudWhileRecording: boolean;
}

export type PreRecordMenu = "mic" | "camera" | "overflow";

export interface PreRecordHudProps {
  mode: PreRecordMode;
  onModeChange: (mode: PreRecordMode) => void;
  /** Chosen source label, e.g. "Studio Display" / "Figma — Onboarding.fig". */
  sourceLabel: string;
  onOpenSourcePicker: () => void;
  sourcePickerOpen?: boolean | undefined;

  micOn: boolean;
  micDeviceId: string;
  micDevices: ReadonlyArray<HudDevice>;
  /** Live input level 0..1 while the mic is on. */
  micLevel?: number | undefined;
  /** Device id to turn the mic on with that device, `null` = Off. */
  onMicChange: (deviceId: string | null) => void;

  systemAudio: boolean;
  systemAudioSupported: boolean;
  /** Why system audio is disabled. */
  systemAudioNote?: string | undefined;
  onSystemAudioChange: (on: boolean) => void;

  cameraOn: boolean;
  cameraDeviceId: string;
  cameraDevices: ReadonlyArray<HudDevice>;
  onCameraChange: (deviceId: string | null) => void;
  onShowPreview: () => void;

  options: PreRecordOptions;
  onOptionsChange: (patch: Partial<PreRecordOptions>) => void;
  onOpenSettings?: (() => void) | undefined;

  onRecord: () => void;
  recordDisabled?: boolean | undefined;
  /** Shown instead of the tooltip while a start is in progress. */
  busyLabel?: string | undefined;
  /** Accelerator shown in the Record tooltip, e.g. "⌘⇧R". */
  recordShortcut: string;

  /** Open menu (controlled so the container can grow the window first). */
  openMenu: PreRecordMenu | null;
  onMenuChange: (menu: PreRecordMenu | null) => void;
}
