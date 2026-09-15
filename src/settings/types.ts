import type { ResponseOf } from "@contracts";
import type { SectionId } from "./sections";
import type { SettingsServices } from "./services";

/**
 * Renderer settings types. `SettingsState` IS the main-process `SettingsSchema`
 * (electron/settings/schema.ts, via the merged contracts) minus the storage-only
 * `schemaVersion`, so every window edits exactly what main persists.
 */

/** Settings as main returns them from `settings:get` / `settings:changed`. */
export type MainSettings = ResponseOf<"settings:get">;
export type SettingsState = Omit<MainSettings, "schemaVersion">;
export type SettingsKey = keyof SettingsState;
export type SettingsPatch = Partial<SettingsState>;

export type Theme = SettingsState["theme"];
export type Fps = SettingsState["defaultFps"];
export type Countdown = SettingsState["defaultCountdown"];
export type CaptureBackend = SettingsState["captureBackend"];
export type AccentColor = SettingsState["accentColor"];
export type Density = SettingsState["density"];
export type LogLevel = SettingsState["logLevel"];
export type UpdateChannel = SettingsState["updateChannel"];
export type DefaultSource = SettingsState["defaultSource"];
export type DefaultAspect = SettingsState["defaultAspect"];
export type PreviewQuality = SettingsState["previewQuality"];
export type GpuExport = SettingsState["gpuExport"];

/** Updater state as pushed on `updater:changed`. */
export type UpdaterState = ResponseOf<"updater:status">;

export interface SettingsProps {
  settings: SettingsState;
  onChange: (patch: SettingsPatch) => void;
  /** Invoked when the user asks to change the recordings folder (native picker lives upstream). */
  onChangeRecordingsFolder?: (() => void) | undefined;
  /** Optional platform services; pages degrade to disabled/placeholder states without them. */
  services?: SettingsServices | undefined;
  /** Initial page (e.g. deep link from the "?" overlay's "Customize…"). */
  initialSection?: SectionId | undefined;
}

/** Mirrors `createDefaultSettings` in main (asserted by a test). */
export const sampleSettings: SettingsState = {
  language: "system",
  recordingsFolder: "~/Movies/Reelform",
  openEditorAfterRecording: true,
  launchAtLogin: false,
  showInTray: true,
  sendUsageStats: false,
  checkUpdates: true,
  autoPrune: true,
  autoPruneDays: 14,
  onboardingCompleted: false,

  defaultSource: "display",
  defaultFps: 60,
  defaultMicId: null,
  defaultCameraId: null,
  defaultSystemAudio: false,
  defaultCountdown: 3,
  hideHudWhileRecording: false,
  hideDesktopIcons: false,
  doNotDisturbWhileRecording: false,
  showClicksDuringCapture: false,
  hideCursorByDefault: false,
  recordTypedTextBadges: false,
  autoDeleteRawAfterExport: false,
  maxLengthHours: 3,
  diskWarningThresholdGb: 2,

  defaultFramePreset: "default",
  defaultAspect: "auto",
  autosaveIntervalSec: 30,
  previewQuality: "auto",
  autoZoomOnNewRecording: true,
  autoZoomSensitivity: 0.5,
  snapByDefault: true,
  undoHistorySize: 200,
  inspectorAutoSwitch: true,

  shortcuts: {},

  theme: "system",
  accentColor: "indigo",
  density: "comfortable",
  reduceMotion: false,

  updateChannel: "stable",

  extensionsEnabled: {},

  captureBackend: "auto",
  gpuExport: "auto",
  logLevel: "info",
};

/** Every settings key, in schema order. */
export const SETTINGS_KEYS = Object.keys(sampleSettings) as readonly SettingsKey[];
