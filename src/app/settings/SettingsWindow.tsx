import { Button } from "@design/components";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { I18nProvider } from "../../i18n";
import { Onboarding } from "../../onboarding/Onboarding";
import type { OnboardingPort } from "../../onboarding/types";
import { Settings } from "../../settings/Settings";
import type { SectionId } from "../../settings/sections";
import type {
  DeviceOption,
  GlobalShortcutStatus,
  SettingsServices,
  SystemPort,
} from "../../settings/services";
import type { SettingsPatch } from "../../settings/types";
import { ShortcutsProvider } from "../../shortcuts/ShortcutsProvider";
import type { ShortcutPlatform } from "../../shortcuts/accelerator";
import type { ShortcutScope } from "../../shortcuts/registry";
import { getAppVersion } from "../ipc";
import { useAppearance } from "./appearance";
import {
  type GlobalStatusPort,
  browserEnumerateDevices,
  copyDiagnosticsViaIpc,
  createIpcOnboardingPort,
  detectShortcutPlatform,
  ipcGlobalStatusPort,
  ipcSystemPort,
  pickFolderViaIpc,
} from "./ports";
import { type AppSettingsStore, type SettingsSyncError, useAppSettings } from "./store";
import { type UpdaterPort, ipcUpdaterPort, useUpdater } from "./updater";

/** Friendly copy for a rejected settings write. */
export function settingsErrorMessage(error: SettingsSyncError): string {
  switch (error.code) {
    case "SHORTCUT_CONFLICT":
      return "That shortcut is already in use, so it wasn't saved.";
    case "INVALID_PATCH":
      return "That value isn't allowed, so it wasn't saved.";
    case "WRITE_FAILED":
      return "Couldn't write your settings to disk. Your change was undone.";
    default:
      return `Couldn't save settings: ${error.message}`;
  }
}

/**
 * Live global shortcut status: fetched once, then replaced by every
 * `shortcuts:globalStatusChanged` push. A push that lands before the initial
 * fetch resolves wins (it is newer).
 */
export function useGlobalShortcutStatus(port: GlobalStatusPort): GlobalShortcutStatus | null {
  const [status, setStatus] = useState<GlobalShortcutStatus | null>(null);
  useEffect(() => {
    let live = true;
    let pushed = false;
    const unsubscribe = port.subscribe((next) => {
      pushed = true;
      if (live) setStatus(next);
    });
    port.get().then(
      (initial) => {
        if (live && !pushed && initial) setStatus(initial);
      },
      () => undefined,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [port]);
  return status;
}

/** Load settings once for this window; returns the live state. */
export function useSyncedSettings(store: AppSettingsStore = useAppSettings) {
  const state = store();
  useEffect(() => {
    void store.getState().init();
  }, [store]);
  return state;
}

export interface SettingsWindowProps {
  store?: AppSettingsStore | undefined;
  updaterPort?: UpdaterPort | undefined;
  system?: SystemPort | undefined;
  enumerateDevices?: (() => Promise<DeviceOption[]>) | undefined;
  platform?: ShortcutPlatform | undefined;
  pickFolder?: ((current: string) => Promise<string | null>) | undefined;
  copyDiagnostics?: (() => Promise<boolean>) | undefined;
  appVersion?: string | null | undefined;
  initialSection?: SectionId | undefined;
  /** Where "Run setup again" goes; defaults to showing onboarding inside this window. */
  onRunOnboarding?: (() => void) | undefined;
  onboardingPort?: OnboardingPort | undefined;
  /** Global shortcut registration status; defaults to IPC. */
  globalStatusPort?: GlobalStatusPort | undefined;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-app)",
        color: "var(--text-2)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** S24 Settings window wired to settings/updater/system IPC. Route: `?window=settings`. */
export function SettingsWindow({
  store = useAppSettings,
  updaterPort = ipcUpdaterPort,
  system = ipcSystemPort,
  enumerateDevices,
  platform,
  pickFolder = pickFolderViaIpc,
  copyDiagnostics = copyDiagnosticsViaIpc,
  appVersion: appVersionProp,
  initialSection,
  onRunOnboarding,
  onboardingPort,
  globalStatusPort = ipcGlobalStatusPort,
}: SettingsWindowProps) {
  const { status, settings, lastError, patch, reset, clearError } = useSyncedSettings(store);
  useAppearance(settings);
  const updater = useUpdater(updaterPort);
  const globalStatus = useGlobalShortcutStatus(globalStatusPort);
  const [appVersion, setAppVersion] = useState<string | null>(appVersionProp ?? null);
  const [onboarding, setOnboarding] = useState(false);

  useEffect(() => {
    if (appVersionProp !== undefined) return;
    let live = true;
    getAppVersion().then(
      (v) => live && setAppVersion(v),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [appVersionProp]);

  const onChange = useCallback((p: SettingsPatch) => void patch(p), [patch]);
  const devices = useMemo(() => enumerateDevices ?? browserEnumerateDevices(), [enumerateDevices]);

  const services: SettingsServices = {
    platform: platform ?? detectShortcutPlatform(),
    appVersion,
    enumerateDevices: devices,
    system,
    updater,
    globalStatus,
    copyDiagnostics,
    resetAll: async () => (await reset()).ok,
    runOnboarding: onRunOnboarding ?? (() => setOnboarding(true)),
  };

  const port = useMemo(
    () =>
      onboardingPort ??
      createIpcOnboardingPort({ saveSettings: async (p) => (await patch(p)).ok, pickFolder }),
    [onboardingPort, patch, pickFolder],
  );

  if (status === "idle" || status === "loading") {
    return <Centered>Loading settings…</Centered>;
  }
  if (status === "error") {
    return (
      <Centered>
        <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>
          Couldn't load settings{lastError ? `: ${lastError.message}` : "."}
        </p>
        <Button
          onClick={() => {
            store.getState().dispose();
            void store.getState().init();
          }}
        >
          Try again
        </Button>
      </Centered>
    );
  }

  if (onboarding) {
    return (
      <Onboarding
        port={port}
        initialDraft={settings}
        appVersion={appVersion}
        onFinish={() => setOnboarding(false)}
      />
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {lastError ? (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-2) var(--space-4)",
            background: "var(--bg-panel-raised)",
            borderBottom: "1px solid var(--border)",
            color: "var(--danger)",
            fontSize: "13px",
          }}
        >
          <span style={{ flex: 1 }}>{settingsErrorMessage(lastError)}</span>
          <Button variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {status === "offline" ? (
        <output
          style={{
            display: "block",
            padding: "var(--space-1) var(--space-4)",
            fontSize: "12px",
            color: "var(--text-3)",
          }}
        >
          Not connected to Reelform — changes are kept for this session only.
        </output>
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <I18nProvider language={settings.language}>
          <Settings
            settings={settings}
            onChange={onChange}
            services={services}
            initialSection={initialSection}
            onChangeRecordingsFolder={async () => {
              const picked = await pickFolder(settings.recordingsFolder).catch(() => null);
              if (picked) void patch({ recordingsFolder: picked });
            }}
          />
        </I18nProvider>
      </div>
    </div>
  );
}

/** `ShortcutsProvider` fed by the synced settings' overrides. */
export function AppShortcutsProvider({
  store = useAppSettings,
  platform,
  rootScope,
  enabled,
  children,
}: {
  store?: AppSettingsStore | undefined;
  platform?: ShortcutPlatform | undefined;
  rootScope?: ShortcutScope | undefined;
  enabled?: boolean | undefined;
  children?: ReactNode;
}) {
  const { settings } = useSyncedSettings(store);
  return (
    <ShortcutsProvider
      platform={platform ?? detectShortcutPlatform()}
      overrides={settings.shortcuts}
      rootScope={rootScope}
      enabled={enabled}
    >
      {children}
    </ShortcutsProvider>
  );
}

/**
 * First-run gate for the launcher window: shows onboarding until
 * `onboardingCompleted`, otherwise renders `children`.
 */
export function OnboardingGate({
  store = useAppSettings,
  port,
  pickFolder = pickFolderViaIpc,
  appVersion,
  onImportProject,
  children,
}: {
  store?: AppSettingsStore | undefined;
  port?: OnboardingPort | undefined;
  pickFolder?: ((current: string) => Promise<string | null>) | undefined;
  appVersion?: string | null | undefined;
  onImportProject?: (() => void) | undefined;
  children?: ReactNode;
}) {
  const { status, settings, patch } = useSyncedSettings(store);
  // Decided once when settings first load: saving `onboardingCompleted` on
  // Finish must not yank the user past the Done step.
  const [showing, setShowing] = useState<boolean | null>(null);
  const loaded = status !== "idle" && status !== "loading";
  const completed = settings.onboardingCompleted;
  useEffect(() => {
    if (loaded && showing === null) setShowing(status !== "error" && !completed);
  }, [loaded, showing, status, completed]);
  const resolvedPort = useMemo(
    () =>
      port ??
      createIpcOnboardingPort({ saveSettings: async (p) => (await patch(p)).ok, pickFolder }),
    [port, patch, pickFolder],
  );
  if (!loaded || showing === null) return <Centered>Loading…</Centered>;
  if (!showing) return <>{children}</>;
  return (
    <Onboarding
      port={resolvedPort}
      initialDraft={settings}
      appVersion={appVersion}
      onImportProject={onImportProject}
      onFinish={() => setShowing(false)}
    />
  );
}
