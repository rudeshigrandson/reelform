import { Notification, shell, systemPreferences } from "electron";
import type { PermissionsDeps, PermissionsSystem } from "./index";

/**
 * Thin Electron binding. Untested by design.
 *
 * Electron exposes no CGPreflight/CGRequestScreenCaptureAccess; on macOS
 * `getMediaAccessStatus('screen')` wraps the preflight. Pass the Swift helper's
 * `preflightScreenCapture` / `requestScreenCapture` when available.
 */
export function createElectronPermissionsDeps(
  extra: Pick<PermissionsSystem, "preflightScreenCapture" | "requestScreenCapture"> = {},
): PermissionsDeps {
  const platform =
    process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";

  const system: PermissionsSystem = {
    platform,
    getMediaAccessStatus: (media) =>
      platform === "linux" ? "unknown" : systemPreferences.getMediaAccessStatus(media),
    preflightScreenCapture: extra.preflightScreenCapture,
    requestScreenCapture: extra.requestScreenCapture,
    isTrustedAccessibilityClient: (prompt) =>
      platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(prompt) : true,
    askForMediaAccess: (media) =>
      platform === "darwin" ? systemPreferences.askForMediaAccess(media) : Promise.resolve(false),
    getNotificationStatus: () => (Notification.isSupported() ? "not-determined" : "not-applicable"),
    requestNotifications: async () => {
      if (!Notification.isSupported()) return;
      new Notification({ title: "Reelform", body: "Notifications are on.", silent: true }).show();
    },
  };

  return { system, openExternal: (url) => shell.openExternal(url) };
}
