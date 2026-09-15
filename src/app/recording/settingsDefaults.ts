import type { Countdown, Fps, LauncherDefaults, SourceMode } from "../../launcher/types";
import type { SettingsState } from "../../settings/types";

/**
 * Settings → initial recording choices for the launcher and the pre-record HUD
 * (guide S05/S24, SPEC §11). Onboarding writes the same keys, so its choices
 * apply too. Only valid values are copied; anything else keeps the
 * component's own fallback.
 */

export type RecordingDefaultsSettings = Pick<
  SettingsState,
  | "defaultSource"
  | "defaultFps"
  | "defaultCountdown"
  | "defaultMicId"
  | "defaultCameraId"
  | "defaultSystemAudio"
  | "hideCursorByDefault"
>;

const SOURCE_MODE: Record<string, SourceMode> = {
  display: "screen",
  window: "window",
  region: "region",
};

const isFps = (v: unknown): v is Fps => v === 30 || v === 60;
const isCountdown = (v: unknown): v is Countdown => v === 0 || v === 3 || v === 5 || v === 10;
const deviceId = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function launcherDefaultsFromSettings(
  settings: Partial<RecordingDefaultsSettings> | null | undefined,
): LauncherDefaults {
  const s = settings ?? {};
  const out: LauncherDefaults = {};
  const mode = typeof s.defaultSource === "string" ? SOURCE_MODE[s.defaultSource] : undefined;
  if (mode) out.mode = mode;
  if (isFps(s.defaultFps)) out.fps = s.defaultFps;
  if (isCountdown(s.defaultCountdown)) out.countdown = s.defaultCountdown;
  if ("defaultMicId" in s) {
    const mic = deviceId(s.defaultMicId);
    out.mic = mic !== null;
    if (mic !== null) out.micDeviceId = mic;
  }
  if ("defaultCameraId" in s) {
    const cam = deviceId(s.defaultCameraId);
    out.webcam = cam !== null;
    if (cam !== null) out.webcamDeviceId = cam;
  }
  if (typeof s.defaultSystemAudio === "boolean") out.systemAudio = s.defaultSystemAudio;
  if (typeof s.hideCursorByDefault === "boolean") out.hideCursor = s.hideCursorByDefault;
  return out;
}

/** Stable identity for memoising / refreshing on a settings change. */
export function launcherDefaultsKey(defaults: LauncherDefaults | undefined): string {
  if (!defaults) return "";
  const keys = Object.keys(defaults).sort() as Array<keyof LauncherDefaults>;
  return JSON.stringify(keys.map((k) => [k, defaults[k]]));
}
