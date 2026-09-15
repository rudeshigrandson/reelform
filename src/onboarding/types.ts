import type { ResponseOf } from "@contracts";
import type { SettingsPatch } from "../settings/types";

// ---- OS permission model (from `permissions:status`, SPEC §11) -----------

export type PermissionsSnapshot = ResponseOf<"permissions:status">;
export type OsPermissionKind = keyof PermissionsSnapshot["permissions"];
export type PermissionEntry = PermissionsSnapshot["permissions"][OsPermissionKind];
export type OsPermissionStatus = PermissionEntry["status"];
export type RequestPermissionResult = ResponseOf<"permissions:request">;

/** Everything onboarding needs from the platform; adapted to IPC in `src/app/settings`. */
export interface OnboardingPort {
  /** null outside Electron (permissions managed elsewhere). */
  status(): Promise<PermissionsSnapshot | null>;
  request(kind: OsPermissionKind): Promise<RequestPermissionResult | null>;
  openSettings(kind: OsPermissionKind): Promise<boolean>;
  /** Native folder picker; null when cancelled/unavailable. */
  pickFolder(current: string): Promise<string | null>;
  /** Write settings; resolves whether main accepted them. */
  saveSettings(patch: SettingsPatch): Promise<boolean>;
}

export interface IntervalTimer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

// ---- Legacy dev-shell props (src/App.tsx) --------------------------------

export type PermissionKind = "screen" | "microphone" | "accessibility";
export type PermissionStatus = "granted" | "needed";
export type PermissionsState = Record<PermissionKind, PermissionStatus>;

export type Fps = 30 | 60;
export type Countdown = 0 | 3 | 5 | 10;

export interface OnboardingDefaults {
  fps: Fps;
  countdown: Countdown;
  recordingsFolder: string;
  autoDeleteRawAfterExport?: boolean | undefined;
  openEditorAfterRecording?: boolean | undefined;
}

export interface OnboardingProps {
  permissions: PermissionsState;
  onRequestPermission: (kind: PermissionKind) => void;
  defaults: OnboardingDefaults;
  onDefaultsChange: (patch: Partial<OnboardingDefaults>) => void;
  onFinish: () => void;
}

export const sampleOnboardingProps: OnboardingProps = {
  permissions: {
    screen: "needed",
    microphone: "needed",
    accessibility: "needed",
  },
  onRequestPermission: () => {},
  defaults: {
    fps: 30,
    countdown: 3,
    recordingsFolder: "~/Movies/Reelform",
  },
  onDefaultsChange: () => {},
  onFinish: () => {},
};
