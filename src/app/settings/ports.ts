import type { OnboardingPort } from "../../onboarding/types";
import type { DeviceOption, GlobalShortcutStatus, SystemPort } from "../../settings/services";
import type { SettingsPatch } from "../../settings/types";
import type { ShortcutPlatform } from "../../shortcuts/accelerator";
import { invoke, onEvent } from "../ipc";

/** IPC adapters for the Settings / onboarding ports. All resolve safely outside Electron. */

export const ipcSystemPort: SystemPort = {
  openLogsFolder: async () => (await invoke("system:openLogsFolder", undefined))?.ok ?? false,
  getCacheSize: async () => (await invoke("system:cacheInfo", undefined))?.bytes ?? null,
  clearCache: async () => (await invoke("system:clearCache", undefined))?.ok ?? false,
  openExternal: async (url) => {
    const res = await invoke("system:openExternal", { url });
    if (res === null && typeof window !== "undefined") window.open(url, "_blank", "noopener");
  },
};

/** Source of main's global shortcut registration status (SPEC §11 conflicts). */
export interface GlobalStatusPort {
  /** Current status; null outside Electron. */
  get(): Promise<GlobalShortcutStatus | null>;
  /** Pushes on every registration change; returns an unsubscribe. */
  subscribe(cb: (status: GlobalShortcutStatus) => void): () => void;
}

export const ipcGlobalStatusPort: GlobalStatusPort = {
  get: () => invoke("shortcuts:globalStatus", undefined),
  subscribe: (cb) => onEvent("shortcuts:globalStatusChanged", cb),
};

export async function pickFolderViaIpc(
  current: string,
  title = "Choose where recordings go",
): Promise<string | null> {
  const res = await invoke("system:pickFolder", { title, defaultPath: current });
  return res?.path ?? null;
}

export async function copyDiagnosticsViaIpc(): Promise<boolean> {
  return (await invoke("system:copyDiagnostics", undefined))?.ok ?? false;
}

export function createIpcOnboardingPort(deps: {
  saveSettings: (patch: SettingsPatch) => Promise<boolean>;
  pickFolder?: ((current: string) => Promise<string | null>) | undefined;
}): OnboardingPort {
  return {
    status: () => invoke("permissions:status", undefined),
    request: (kind) => invoke("permissions:request", { kind }),
    openSettings: async (kind) => (await invoke("permissions:openSettings", { kind }))?.ok ?? false,
    pickFolder: deps.pickFolder ?? ((current) => pickFolderViaIpc(current)),
    saveSettings: deps.saveSettings,
  };
}

/** `navigator.mediaDevices.enumerateDevices` → mic/camera options; undefined when unsupported. */
export function browserEnumerateDevices(): (() => Promise<DeviceOption[]>) | undefined {
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.enumerateDevices) return undefined;
  return async () => {
    const all = await md.enumerateDevices();
    return all
      .filter(
        (d): d is MediaDeviceInfo & { kind: DeviceOption["kind"] } =>
          d.kind === "audioinput" || d.kind === "videoinput",
      )
      .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label }));
  };
}

export function detectShortcutPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "mac" : "win";
}
