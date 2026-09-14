import { settingsDeepLink } from "./settingsLinks";

/**
 * OS permission status model (ENGINEERING_SPEC §11, DESIGN_GUIDE S02).
 *
 * - macOS: screen via CGPreflightScreenCaptureAccess (injected) falling back to
 *   `getMediaAccessStatus('screen')`; mic/camera via `getMediaAccessStatus`;
 *   accessibility via `isTrustedAccessibilityClient`; notifications injected.
 * - Windows: only microphone/camera are gated by the OS privacy settings.
 * - Linux: nothing is gated at this level → all `not-applicable`.
 */

export const PERMISSION_KINDS = [
  "screen",
  "microphone",
  "camera",
  "accessibility",
  "notifications",
] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export type PermissionStatus =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "not-applicable";

export type PermissionPlatform = "darwin" | "win32" | "linux";

export interface PermissionEntry {
  kind: PermissionKind;
  status: PermissionStatus;
  /** Recording cannot start without it. */
  required: boolean;
  /** A request action can prompt (or re-prompt) from inside the app. */
  canRequest: boolean;
  /** A System Settings pane deep link exists. */
  canOpenSettings: boolean;
}

export interface PermissionsSnapshot {
  platform: PermissionPlatform;
  permissions: Record<PermissionKind, PermissionEntry>;
}

/** Raw values returned by `systemPreferences.getMediaAccessStatus`. */
export type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** Everything OS-specific, injected (Electron adapter builds the real one). */
export interface PermissionsSystem {
  platform: PermissionPlatform;
  getMediaAccessStatus(media: "microphone" | "camera" | "screen"): MediaAccessStatus;
  /** macOS `CGPreflightScreenCaptureAccess()`; absent → fall back to media status. */
  preflightScreenCapture?: (() => boolean) | undefined;
  /** macOS `CGRequestScreenCaptureAccess()` (prompts once); absent → open Settings. */
  requestScreenCapture?: (() => boolean) | undefined;
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  askForMediaAccess(media: "microphone" | "camera"): Promise<boolean>;
  /** Notification permission if the platform can report it. */
  getNotificationStatus?: (() => PermissionStatus) | undefined;
  /** Trigger the OS notification prompt (e.g. first notification). */
  requestNotifications?: (() => Promise<void>) | undefined;
}

export function mapMediaStatus(s: MediaAccessStatus): PermissionStatus {
  switch (s) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "restricted":
      return "restricted";
    default:
      return "not-determined";
  }
}

/** Which kinds the OS gates on a platform. */
export function isApplicable(platform: PermissionPlatform, kind: PermissionKind): boolean {
  if (platform === "darwin") return true;
  if (platform === "win32") return kind === "microphone" || kind === "camera";
  return false;
}

export function readPermissionStatus(
  sys: PermissionsSystem,
  kind: PermissionKind,
): PermissionStatus {
  if (!isApplicable(sys.platform, kind)) return "not-applicable";
  switch (kind) {
    case "screen": {
      if (sys.preflightScreenCapture?.()) return "granted";
      const media = mapMediaStatus(sys.getMediaAccessStatus("screen"));
      // Preflight said no: never report granted from the fallback.
      if (sys.preflightScreenCapture && media === "granted") return "denied";
      return media;
    }
    case "microphone":
    case "camera":
      return mapMediaStatus(sys.getMediaAccessStatus(kind));
    case "accessibility":
      // macOS cannot distinguish "denied" from "never asked" without prompting.
      return sys.isTrustedAccessibilityClient(false) ? "granted" : "not-determined";
    case "notifications":
      return sys.getNotificationStatus?.() ?? "not-determined";
  }
}

function canRequest(
  sys: PermissionsSystem,
  kind: PermissionKind,
  status: PermissionStatus,
): boolean {
  if (status === "granted" || status === "not-applicable" || status === "restricted") return false;
  if (sys.platform !== "darwin") return false;
  switch (kind) {
    case "microphone":
    case "camera":
      // macOS only shows the prompt while undetermined; afterwards Settings only.
      return status === "not-determined";
    case "screen":
      return status === "not-determined" && sys.requestScreenCapture !== undefined;
    case "accessibility":
      return true;
    case "notifications":
      return sys.requestNotifications !== undefined;
  }
}

export function readPermissions(sys: PermissionsSystem): PermissionsSnapshot {
  const entries = {} as Record<PermissionKind, PermissionEntry>;
  for (const kind of PERMISSION_KINDS) {
    const status = readPermissionStatus(sys, kind);
    entries[kind] = {
      kind,
      status,
      required: kind === "screen" && sys.platform === "darwin",
      canRequest: canRequest(sys, kind, status),
      canOpenSettings: status !== "not-applicable" && settingsDeepLink(sys.platform, kind) !== null,
    };
  }
  return { platform: sys.platform, permissions: entries };
}

export type RequestOutcome = "prompted" | "open-settings" | "none";

/**
 * Request a permission. Prompts in-app when the OS allows; otherwise reports
 * `open-settings` so the caller deep-links the user to the right pane.
 */
export async function requestPermission(
  sys: PermissionsSystem,
  kind: PermissionKind,
): Promise<{ status: PermissionStatus; outcome: RequestOutcome }> {
  const before = readPermissionStatus(sys, kind);
  if (before === "granted" || before === "not-applicable")
    return { status: before, outcome: "none" };
  if (!canRequest(sys, kind, before)) {
    return {
      status: before,
      outcome: settingsDeepLink(sys.platform, kind) ? "open-settings" : "none",
    };
  }
  switch (kind) {
    case "microphone":
    case "camera":
      await sys.askForMediaAccess(kind);
      break;
    case "screen":
      sys.requestScreenCapture?.();
      break;
    case "accessibility":
      sys.isTrustedAccessibilityClient(true);
      break;
    case "notifications":
      await sys.requestNotifications?.();
      break;
  }
  return { status: readPermissionStatus(sys, kind), outcome: "prompted" };
}

export function snapshotsEqual(a: PermissionsSnapshot, b: PermissionsSnapshot): boolean {
  if (a.platform !== b.platform) return false;
  return PERMISSION_KINDS.every((k) => {
    const x = a.permissions[k];
    const y = b.permissions[k];
    return (
      x.status === y.status &&
      x.required === y.required &&
      x.canRequest === y.canRequest &&
      x.canOpenSettings === y.canOpenSettings
    );
  });
}
