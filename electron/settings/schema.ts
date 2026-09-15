import { z } from "zod";
import { parseAccelerator } from "../../src/shortcuts/accelerator";

/**
 * Settings schema (ENGINEERING_SPEC §11, design guide S24 pages). A superset
 * of `src/settings/types.ts` `SettingsState` so the existing Settings UI keeps
 * working with the same keys. Stored flat in `userData/settings.json` with a
 * `schemaVersion` field; see `migrations.ts`.
 */

export const SETTINGS_SCHEMA_VERSION = 2;

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export const ACCENT_COLORS = ["indigo", "blue", "violet", "pink", "orange", "green"] as const;

/** Keys whose values are filesystem paths (dropped from diagnostics bundles). */
export const SETTINGS_PATH_KEYS = ["recordingsFolder"] as const;

/** Cap on saved frame presets (Inspector › Frame "Save current as preset…"). */
export const FRAME_USER_PRESETS_MAX = 100;

/**
 * A user frame preset. `settings` is the renderer's `FrameSettings`; main only
 * checks it is a plain object so a future frame-schema change can't wipe every
 * saved preset through per-key repair. The Frame tab validates it strictly.
 */
const frameUserPreset = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    builtIn: z.boolean(),
    settings: z.record(z.string().min(1).max(64), z.unknown()),
  })
  .strict();

const shortcutOverride = z
  .string()
  .max(64)
  .refine((v) => v === "" || parseAccelerator(v, "win") !== null, {
    message: "Invalid accelerator",
  });

export const SettingsShape = {
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),

  // ---- General ----
  language: z.string().min(1).max(35),
  recordingsFolder: z.string().min(1),
  openEditorAfterRecording: z.boolean(),
  launchAtLogin: z.boolean(),
  showInTray: z.boolean(),
  sendUsageStats: z.boolean(),
  checkUpdates: z.boolean(),
  autoPrune: z.boolean(),
  autoPruneDays: z.number().int().min(1).max(365),
  /** First-run onboarding finished (S01–S03); re-entered from Settings › General. */
  onboardingCompleted: z.boolean(),

  // ---- Recording ----
  defaultSource: z.enum(["display", "window", "region"]),
  defaultFps: z.union([z.literal(30), z.literal(60)]),
  defaultMicId: z.string().nullable(),
  defaultCameraId: z.string().nullable(),
  defaultSystemAudio: z.boolean(),
  defaultCountdown: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]),
  hideHudWhileRecording: z.boolean(),
  hideDesktopIcons: z.boolean(),
  doNotDisturbWhileRecording: z.boolean(),
  showClicksDuringCapture: z.boolean(),
  hideCursorByDefault: z.boolean(),
  autoDeleteRawAfterExport: z.boolean(),
  maxLengthHours: z.number().min(0.1).max(24),
  diskWarningThresholdGb: z.number().min(0.5).max(1000),
  /** §9.7 "Record typed text badges": keep plain typing in telemetry. Off by default (§13). */
  recordTypedTextBadges: z.boolean(),

  // ---- Editor ----
  defaultFramePreset: z.string().min(1).max(64),
  defaultAspect: z.enum(["auto", "16:9", "9:16", "1:1", "4:3"]),
  autosaveIntervalSec: z.number().int().min(5).max(600),
  previewQuality: z.enum(["auto", "full", "half"]),
  autoZoomOnNewRecording: z.boolean(),
  autoZoomSensitivity: z.number().min(0).max(1),
  snapByDefault: z.boolean(),
  undoHistorySize: z.number().int().min(10).max(1000),
  inspectorAutoSwitch: z.boolean(),
  /** Saved frame presets, oldest first. */
  frameUserPresets: z.array(frameUserPreset).max(FRAME_USER_PRESETS_MAX),

  // ---- Shortcuts (id → canonical accelerator; "" = unbound) ----
  shortcuts: z.record(z.string().min(1).max(64), shortcutOverride),

  // ---- Appearance ----
  theme: z.enum(["system", "light", "dark"]),
  accentColor: z.enum(ACCENT_COLORS),
  density: z.enum(["comfortable", "compact"]),
  reduceMotion: z.boolean(),

  // ---- Updates ----
  updateChannel: z.enum(["stable", "beta"]),

  // ---- Extensions ----
  extensionsEnabled: z.record(z.string().min(1), z.boolean()),

  // ---- Advanced ----
  captureBackend: z.enum(["auto", "native", "electron"]),
  gpuExport: z.enum(["auto", "on", "off"]),
  logLevel: z.enum(LOG_LEVELS),
} as const;

export const SettingsSchema = z.object(SettingsShape).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsKey = Exclude<keyof Settings, "schemaVersion">;

/** A partial update from a renderer: known keys only, each fully validated. */
export const SettingsPatchSchema = SettingsSchema.omit({ schemaVersion: true }).partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export interface DefaultSettingsEnv {
  /** Platform default recordings folder, e.g. `~/Movies/Reelform` resolved by the adapter. */
  recordingsFolder: string;
}

export function createDefaultSettings(env: DefaultSettingsEnv): Settings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    language: "system",
    recordingsFolder: env.recordingsFolder,
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
    autoDeleteRawAfterExport: false,
    maxLengthHours: 3,
    diskWarningThresholdGb: 2,
    recordTypedTextBadges: false,

    defaultFramePreset: "default",
    defaultAspect: "auto",
    autosaveIntervalSec: 30,
    previewQuality: "auto",
    autoZoomOnNewRecording: true,
    autoZoomSensitivity: 0.5,
    snapByDefault: true,
    undoHistorySize: 200,
    inspectorAutoSwitch: true,
    frameUserPresets: [],

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
}

/** Keys whose value differs between two settings objects (deep compare via JSON). */
export function changedKeys(prev: Settings, next: Settings): SettingsKey[] {
  const out: SettingsKey[] = [];
  for (const key of Object.keys(SettingsShape) as (keyof Settings)[]) {
    if (key === "schemaVersion") continue;
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) out.push(key);
  }
  return out;
}
