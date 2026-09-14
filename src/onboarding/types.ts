export type PermissionKind = "screen" | "microphone" | "accessibility";
export type PermissionStatus = "granted" | "needed";
export type PermissionsState = Record<PermissionKind, PermissionStatus>;

export type Fps = 30 | 60;
export type Countdown = 0 | 3 | 5 | 10;

export interface OnboardingDefaults {
  fps: Fps;
  countdown: Countdown;
  recordingsFolder: string;
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
