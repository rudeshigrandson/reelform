import type { PermissionKind, PermissionPlatform } from "./permissionModel";

/** System Settings deep links per pane; `null` when the OS has no such pane. */
const MAC_PRIVACY = "x-apple.systempreferences:com.apple.preference.security?";

const LINKS: Record<PermissionPlatform, Partial<Record<PermissionKind, string>>> = {
  darwin: {
    screen: `${MAC_PRIVACY}Privacy_ScreenCapture`,
    microphone: `${MAC_PRIVACY}Privacy_Microphone`,
    camera: `${MAC_PRIVACY}Privacy_Camera`,
    accessibility: `${MAC_PRIVACY}Privacy_Accessibility`,
    notifications: "x-apple.systempreferences:com.apple.preference.notifications",
  },
  win32: {
    microphone: "ms-settings:privacy-microphone",
    camera: "ms-settings:privacy-webcam",
  },
  linux: {},
};

export function settingsDeepLink(
  platform: PermissionPlatform,
  kind: PermissionKind,
): string | null {
  return LINKS[platform][kind] ?? null;
}
