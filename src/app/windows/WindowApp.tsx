import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { InspectorHost } from "../../editor/inspector/host/types";
import { type History, createDocumentUpdate } from "../../editor/state";
import type { EditorState } from "../../editor/store";
import { ProjectsContainer } from "../../projects/ProjectsContainer";
import { browserCaptureDeps, startCapture } from "../../recording";
import type { Platform } from "../../recording/constraints";
import { WindowRoot } from "../../router";
import { ShortcutsOverlayHost } from "../../shortcuts/ShortcutsOverlay";
import { ExportController, createIpcSystemPort as createExportSystemPort } from "../export";
import { createInspectorHost } from "../inspector/createInspectorHost";
import { createMetaUpdate } from "../inspector/historyAdapters";
import { getAppVersion, invoke } from "../ipc";
import { ProjectEditor } from "../project/ProjectEditor";
import {
  CountdownContainer,
  HudContainer,
  LauncherContainer,
  RegionOverlayContainer,
  type SourcesResult,
  WebcamBubbleContainer,
  createBroadcastRecordingBus,
  createIpcProjectPort,
  createIpcRecordingPort,
  createIpcWindowsPort,
  createRecordingFlow,
  createIpcSystemPort as createRecordingSystemPort,
} from "../recording";
import {
  AppShortcutsProvider,
  LauncherUpdateNotice,
  OnboardingGate,
  SettingsWindow,
  useAppSettings,
  useSyncedSettings,
  useUpdater,
} from "../settings";
import { createInspectorSystemPort } from "./inspectorSystemPort";

/**
 * Renderer entry inside Electron (SPEC §2): every BrowserWindow loads the same
 * bundle with `?window=<kind>`; this maps the kind to its screen and gives each
 * one its IPC ports. Settings sync (and theme/appearance) runs in every window.
 */

export function detectPlatform(userAgent: string): Platform {
  if (/Mac/i.test(userAgent)) return "darwin";
  if (/Win/i.test(userAgent)) return "win32";
  return "linux";
}

const glyphPlatform = (p: Platform): InspectorHost["platform"] =>
  p === "darwin" ? "mac" : p === "win32" ? "win" : "linux";

const PLATFORM = detectPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent);

/** Settings sync + appearance for any window; renders children once settings exist. */
function WithSettings({ children }: { children: ReactElement }): ReactElement {
  useSyncedSettings();
  return children;
}

function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getAppVersion()
      .then((v) => {
        if (alive) setVersion(v ?? "0.0.0");
      })
      .catch(() => {
        if (alive) setVersion("0.0.0");
      });
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

const launcherLayout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "var(--space-4)",
  height: "100%",
  minHeight: 0,
  padding: "var(--space-4)",
  boxSizing: "border-box",
  background: "var(--bg-app)",
  color: "var(--text-1)",
};

const paneStyle: CSSProperties = { minHeight: 0, overflow: "auto" };

function LauncherWindow({ appVersion }: { appVersion: string }): ReactElement {
  const updater = useUpdater();
  const deps = useMemo(() => {
    const port = createIpcRecordingPort();
    const windows = createIpcWindowsPort();
    const bus = createBroadcastRecordingBus();
    const system = createRecordingSystemPort(async (path) => {
      await invoke("system:reveal", { path });
    });
    let latestSources: SourcesResult | null = null;
    const flow = createRecordingFlow({
      port,
      windows,
      projects: createIpcProjectPort(),
      system,
      bus,
      startCapture: (options, hooks) =>
        startCapture({ ...browserCaptureDeps(), ...hooks }, options),
      platform: PLATFORM,
      appVersion,
      newId: () => crypto.randomUUID(),
      nowIso: () => new Date().toISOString(),
      openEditorAfterRecording: () => useAppSettings.getState().settings.openEditorAfterRecording,
      sources: () => latestSources,
    });
    return {
      port,
      windows,
      system,
      flow,
      bus,
      setSources: (s: SourcesResult | null) => {
        latestSources = s;
      },
    };
  }, [appVersion]);

  useEffect(
    () => () => {
      deps.flow.dispose();
      deps.bus.close();
    },
    [deps],
  );

  return (
    <OnboardingGate appVersion={appVersion}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <LauncherUpdateNotice updater={updater} />
        <div style={launcherLayout}>
          <div style={paneStyle}>
            <LauncherContainer
              flow={deps.flow}
              port={deps.port}
              enumerateDevices={() => navigator.mediaDevices.enumerateDevices()}
              platform={PLATFORM}
              system={deps.system}
              onSources={deps.setSources}
              onOpenSettings={() => void invoke("windows:openSettings", undefined)}
            />
          </div>
          <div style={paneStyle}>
            <ProjectsContainer invoke={invoke} onNewRecording={() => {}} />
          </div>
        </div>
      </div>
    </OnboardingGate>
  );
}

function EditorRoute({ projectId }: { projectId: string }): ReactElement {
  const undoHistorySize = useAppSettings((s) => s.settings.undoHistorySize);
  const [exportOpen, setExportOpen] = useState(false);
  const exportSystem = useMemo(
    () => createExportSystemPort((channel, payload) => invoke(channel as never, payload as never)),
    [],
  );
  const inspectorSystem = useMemo(() => createInspectorSystemPort(invoke), []);
  // Stable: EditorWindow builds one host per history from this factory.
  const createHost = useCallback(
    (history: History<EditorState>) =>
      createInspectorHost({
        system: inspectorSystem,
        documentUpdate: createDocumentUpdate(history),
        metaUpdate: createMetaUpdate(history),
        platform: glyphPlatform(PLATFORM),
      }),
    [inspectorSystem],
  );

  return (
    <AppShortcutsProvider rootScope="editor">
      <ProjectEditor
        projectId={projectId}
        undoHistorySize={undoHistorySize}
        onExport={() => setExportOpen(true)}
        createInspectorHost={createHost}
      />
      <ExportController
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onOpen={() => setExportOpen(true)}
        systemPort={exportSystem}
      />
      <ShortcutsOverlayHost onCustomize={() => void invoke("windows:openSettings", undefined)} />
    </AppShortcutsProvider>
  );
}

/** Ports shared by the recording overlay windows (HUD, countdown, region, webcam). */
function useOverlayPorts() {
  const ports = useMemo(
    () => ({
      port: createIpcRecordingPort(),
      windows: createIpcWindowsPort(),
      bus: createBroadcastRecordingBus(),
    }),
    [],
  );
  useEffect(() => () => ports.bus.close(), [ports]);
  return ports;
}

function HudWindow(): ReactElement {
  const { port, bus } = useOverlayPorts();
  return <HudContainer port={port} bus={bus} />;
}

function CountdownWindow(): ReactElement {
  const { port, bus, windows } = useOverlayPorts();
  return <CountdownContainer port={port} bus={bus} windows={windows} />;
}

function RegionOverlayWindow({ displayId }: { displayId: string }): ReactElement {
  const { bus, windows } = useOverlayPorts();
  return <RegionOverlayContainer displayId={displayId} bus={bus} windows={windows} />;
}

function WebcamBubbleWindow(): ReactElement {
  const { bus, windows } = useOverlayPorts();
  return (
    <WebcamBubbleContainer
      getUserMedia={(constraints) =>
        navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints)
      }
      bus={bus}
      windows={windows}
    />
  );
}

export interface WindowAppProps {
  /** Defaults to `window.location.search`. */
  search?: string | undefined;
}

export function WindowApp({ search }: WindowAppProps): ReactElement {
  const appVersion = useAppVersion();

  return (
    <WindowRoot
      search={search}
      renderers={{
        launcher: () => (
          <WithSettings>
            {appVersion === null ? <div /> : <LauncherWindow appVersion={appVersion} />}
          </WithSettings>
        ),
        editor: (route) => (
          <WithSettings>
            <EditorRoute projectId={route.projectId} />
          </WithSettings>
        ),
        settings: () => (
          <WithSettings>
            <SettingsWindow appVersion={appVersion} />
          </WithSettings>
        ),
        hud: () => (
          <WithSettings>
            <HudWindow />
          </WithSettings>
        ),
        countdown: () => (
          <WithSettings>
            <CountdownWindow />
          </WithSettings>
        ),
        "region-overlay": (route) => (
          <WithSettings>
            <RegionOverlayWindow displayId={route.displayId} />
          </WithSettings>
        ),
        "webcam-bubble": () => (
          <WithSettings>
            <WebcamBubbleWindow />
          </WithSettings>
        ),
      }}
    />
  );
}
