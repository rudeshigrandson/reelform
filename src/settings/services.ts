import type { ShortcutPlatform } from "../shortcuts/accelerator";
import type { UpdaterState } from "./types";

/**
 * Platform services the Settings pages call. Injected so the pages stay
 * presentational and testable; `src/app/settings` adapts them to IPC.
 */

export interface DeviceOption {
  deviceId: string;
  kind: "audioinput" | "videoinput";
  /** Empty when the OS hides names (media permission not granted). */
  label: string;
}

/** OS utilities behind Advanced/General buttons. */
export interface SystemPort {
  openLogsFolder(): Promise<boolean>;
  /** Bytes, or null when unknown. */
  getCacheSize(): Promise<number | null>;
  clearCache(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}

export interface UpdaterControls {
  state: UpdaterState | null;
  check(): Promise<void>;
  restart(): Promise<void>;
}

export interface SettingsServices {
  platform?: ShortcutPlatform | undefined;
  appVersion?: string | null | undefined;
  enumerateDevices?: (() => Promise<DeviceOption[]>) | undefined;
  system?: SystemPort | undefined;
  updater?: UpdaterControls | undefined;
  /** `system:copyDiagnostics`; resolves whether the clipboard was written. */
  copyDiagnostics?: (() => Promise<boolean>) | undefined;
  /** `settings:reset`. */
  resetAll?: (() => Promise<boolean>) | undefined;
  /** Re-enter onboarding (SPEC §11). */
  runOnboarding?: (() => void) | undefined;
}

export const PRIVACY_URL = "https://reelform.app/privacy";
export const LICENSES_URL = "https://github.com/reelform/app/blob/main/NOTICE.md";
