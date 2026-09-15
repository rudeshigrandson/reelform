import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, shell } from "electron";
import { migrate } from "../src/editor/model/v1/migrations";
import { createCaptionsHandlers } from "./captions";
import { createElectronCaptionsDeps } from "./captions/electronAdapter";
import { createFfmpegSilenceSplitter, createFfmpegWavExtractor } from "./captions/ffmpegPorts";
import { nodeHelperDeps } from "./capture/electronAdapter";
import { verifyHelperBinary } from "./capture/manifest";
import { createElectronDiagnostics } from "./diagnostics/electronAdapter";
import { createExportService } from "./export";
import { createElectronExportDeps } from "./export/electronAdapter";
import { events, type ChannelName } from "./ipc/contracts";
import { handle } from "./ipc/registerIpc";
import {
  createElectronMediaDeps,
  installMediaProtocol,
  nodeRunnerDeps,
  registerMediaSchemePrivileges,
} from "./media/electronAdapter";
import { createMediaHandlers } from "./media/handlers";
import { createMediaRootRegistry } from "./media/roots";
import {
  CURSOR_MONITOR_HELPER_NAME,
  createCursorMonitorBridge,
} from "./native/mac/cursorMonitorBridge";
import { createPermissionsHandlers } from "./permissions/contracts";
import { createElectronPermissionsDeps } from "./permissions/electronAdapter";
import { createProjectHandlers } from "./project";
import { createElectronProjectDeps } from "./project/electronAdapter";
import { createRecordingMain } from "./recording/electronAdapter";
import { createSettingsHandlers } from "./settings/contracts";
import { createElectronSettings } from "./settings/electronAdapter";
import { createSystemFileHandlers } from "./system";
import { createElectronSystemDeps } from "./system/electronAdapter";
import { createProjectFileHandlers } from "./system/projectFiles";
import { createNodeProjectFileDeps } from "./system/projectFilesNode";
import { type TrayController, createElectronTray } from "./tray/electronAdapter";
import type { TrayAction } from "./tray/trayMenu";
import { createUpdaterHandlers } from "./updater/contracts";
import { createElectronUpdater } from "./updater/electronAdapter";
import { createWindowsHandlers } from "./windows/contracts";
import { createElectronWindowManager } from "./windows/electronAdapter";
import { createMemoryHudPositionStore } from "./windows/hudPosition";

/**
 * Main-process composition root (SPEC §2): builds every domain's handlers from
 * its Electron adapter and registers them against the merged contracts. Domain
 * logic lives in `electron/<domain>/`; this file only wires deps together.
 */

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(here, "preload.cjs");
const platformArch = `${process.platform}-${process.arch}`;

// Must run before `app.ready` so reelform-media:// can stream and bypass CSP.
registerMediaSchemePrivileges();

type AnyHandler = (payload: never) => unknown;

/** Register a domain's handler map; keys are channel names from the merged contracts. */
function registerDomain(handlers: { [channel: string]: AnyHandler }): void {
  for (const [name, fn] of Object.entries(handlers)) {
    handle(name as ChannelName, fn as never);
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function validateProjectDocument(doc: unknown) {
  const result = migrate(doc);
  return result.ok
    ? { ok: true as const, value: result.project }
    : { ok: false as const, message: result.error.message, issues: result.error.issues };
}

async function boot(): Promise<void> {
  const { store: settings, shortcuts } = createElectronSettings((id) => {
    // Global shortcuts are forwarded to every window; the HUD/recording UI acts on them.
    broadcast("shortcuts:triggered", { id });
  });
  await settings.load();

  const diagnostics = createElectronDiagnostics({
    level: settings.get().logLevel,
    getSettings: () => settings.get(),
    pathKeys: ["recordingsFolder"],
  });

  const windows = createElectronWindowManager({
    preloadPath,
    loadSource: DEV_URL
      ? { type: "dev", devServerUrl: DEV_URL }
      : { type: "file", indexHtmlPath: path.join(here, "../dist/index.html") },
    hudPositions: createMemoryHudPositionStore(),
  });

  const mediaRoots = createMediaRootRegistry();
  installMediaProtocol(mediaRoots);
  const mediaDeps = createElectronMediaDeps(mediaRoots);
  const ffmpeg = { runner: nodeRunnerDeps, resolveBinaries: mediaDeps.resolveBinaries };

  const projectHandlers = createProjectHandlers(
    createElectronProjectDeps({ validate: validateProjectDocument }),
  );

  const exportService = createExportService(
    createElectronExportDeps({
      // Default destination: the open project's exports/ folder (SPEC §4).
      resolveProjectDir: async (projectId) => {
        try {
          const { path: projectPath } = await projectHandlers["project:resolve"]({ projectId });
          return path.join(projectPath, "exports");
        } catch {
          return null;
        }
      },
    }),
  );

  // Helpers live in <binDir>/<platform>-<arch>/; capture and manifest verification append that.
  const binDir = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(app.getAppPath(), "electron/native/bin");

  // macOS: clicks, keys and cursor types from the native cursor monitor (§5.3).
  // Elsewhere (or when the helper is missing) recording falls back to cursor polling.
  const cursorBridge =
    process.platform === "darwin"
      ? createCursorMonitorBridge({
          resolveBinary: () =>
            verifyHelperBinary(
              { binDir, platformArch, name: CURSOR_MONITOR_HELPER_NAME },
              {
                readFile: async (p) => new Uint8Array(await readFile(p)),
                sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
                join: path.join,
              },
            ),
          helperDeps: nodeHelperDeps,
          log: (message) => console.warn(`[cursor-monitor] ${message}`),
        })
      : null;

  const recording = createRecordingMain({
    binDir,
    settings: () => ({
      keepTypedText: false,
      maxLengthMs: settings.get().maxLengthHours * 3_600_000,
    }),
    targets: () => BrowserWindow.getAllWindows(),
    inputHook: cursorBridge ?? undefined,
  });

  const updater = createElectronUpdater({
    channel: settings.get().updateChannel,
    autoCheckEnabled: () => settings.get().checkUpdates,
  });
  updater.start();

  // Tray / menu bar (§11). Recording controls are forwarded to the recording windows.
  const trayAssets = app.isPackaged
    ? path.join(process.resourcesPath, "tray")
    : path.join(app.getAppPath(), "build/tray");
  const onTrayAction = (action: TrayAction): void => {
    switch (action.type) {
      case "new-recording":
      case "open-editor":
        windows.openLauncher();
        return;
      case "open-recent":
        windows.openEditor(action.projectId);
        return;
      case "settings":
        windows.openSettings();
        return;
      case "quit":
        app.quit();
        return;
      case "pause":
      case "resume":
      case "stop-recording":
        broadcast("tray:action", action);
        return;
    }
  };
  let tray: TrayController | null = null;
  const syncTray = (show: boolean): void => {
    if (show && !tray) {
      tray = createElectronTray(
        {
          template: path.join(trayAssets, "trayTemplate.png"),
          recording: path.join(trayAssets, "trayRecording.png"),
        },
        { recording: "idle", recent: [] },
        onTrayAction,
      );
    } else if (!show && tray) {
      tray.destroy();
      tray = null;
    }
  };

  const applyLoginItem = (openAtLogin: boolean): void => {
    // Only a packaged app should register itself; dev would register the Electron binary.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin });
  };

  const initial = settings.get();
  syncTray(initial.showInTray);
  applyLoginItem(initial.launchAtLogin);
  settings.subscribe((change) => {
    if (change.changed.includes("updateChannel")) updater.setChannel(change.settings.updateChannel);
    if (change.changed.includes("logLevel")) diagnostics.logger.setLevel(change.settings.logLevel);
    if (change.changed.includes("showInTray")) syncTray(change.settings.showInTray);
    if (change.changed.includes("launchAtLogin")) applyLoginItem(change.settings.launchAtLogin);
  });

  registerDomain({
    "system:ping": () => ({ pong: true as const, version: app.getVersion() }),
    "system:openExternal": async ({ url }: { url: string }) => {
      await shell.openExternal(url);
      return { ok: true };
    },
  });
  registerDomain(projectHandlers);
  registerDomain(exportService.handlers);
  registerDomain(createMediaHandlers(mediaDeps));
  registerDomain(recording.handlers);
  registerDomain(
    createCaptionsHandlers(
      createElectronCaptionsDeps({
        extractWav: createFfmpegWavExtractor(ffmpeg),
        splitter: createFfmpegSilenceSplitter(ffmpeg),
        emit: (event) => broadcast(events["captions:progress"].name, event),
      }),
    ),
  );
  registerDomain(createPermissionsHandlers(createElectronPermissionsDeps()));
  registerDomain(createSettingsHandlers({ store: settings, shortcuts }));
  registerDomain(createUpdaterHandlers({ updater }));
  registerDomain(createWindowsHandlers({ manager: windows }));
  registerDomain(
    createSystemFileHandlers(
      createElectronSystemDeps({ focusedWindow: () => BrowserWindow.getFocusedWindow() }),
    ),
  );
  // `system:pickFolder` is registered by the system domain above; ipcMain allows one handler.
  const { "system:pickFolder": _systemOwnsPickFolder, ...diagnosticsHandlers } =
    diagnostics.handlers;
  registerDomain(diagnosticsHandlers);
  registerDomain(createProjectFileHandlers(createNodeProjectFileDeps()));

  windows.openLauncher();

  app.on("before-quit", () => {
    void recording.dispose();
    void exportService.cancelAll();
    cursorBridge?.dispose?.();
    tray?.destroy();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.openLauncher();
  });
  app.on("second-instance", () => {
    windows.openLauncher();
  });
}

// Single-instance lock: a second launch focuses the existing launcher.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(boot, (err: unknown) => {
    console.error("[main] boot failed", err);
    app.exit(1);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
