import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, shell } from "electron";
import { migrate } from "../src/editor/model/v1/migrations";
import { createCaptionsHandlers } from "./captions";
import { createElectronCaptionsDeps } from "./captions/electronAdapter";
import { createFfmpegSilenceSplitter, createFfmpegWavExtractor } from "./captions/ffmpegPorts";
import { createDiagnosticsHandlers } from "./diagnostics/contracts";
import { createElectronDiagnostics } from "./diagnostics/electronAdapter";
import { createExportService } from "./export";
import { createElectronExportDeps } from "./export/electronAdapter";
import { type ChannelName, events } from "./ipc/contracts";
import { handle } from "./ipc/registerIpc";
import { createMediaHandlers } from "./media/handlers";
import {
  createElectronMediaDeps,
  installMediaProtocol,
  nodeRunnerDeps,
  registerMediaSchemePrivileges,
} from "./media/electronAdapter";
import { createMediaRootRegistry } from "./media/roots";
import { createPermissionsHandlers } from "./permissions/contracts";
import { createElectronPermissionsDeps } from "./permissions/electronAdapter";
import { createProjectHandlers } from "./project";
import { createElectronProjectDeps } from "./project/electronAdapter";
import { createRecordingMain } from "./recording/electronAdapter";
import { createSettingsHandlers } from "./settings/contracts";
import { createElectronSettings } from "./settings/electronAdapter";
import { createUpdaterHandlers } from "./updater/contracts";
import { createElectronUpdater } from "./updater/electronAdapter";
import { createWindowsHandlers } from "./windows/contracts";
import { createElectronWindowManager } from "./windows/electronAdapter";
import { createMemoryHudPositionStore } from "./windows/hudPosition";

/**
 * Main-process composition root (SPEC §2): builds every domain's handlers from
 * its Electron adapter and registers them against the merged contracts. Domain
 * logic lives in `electron/<domain>/`; nothing here should need tests beyond
 * the harness booting the app.
 */

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(here, "preload.cjs");

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
    level: app.isPackaged ? "info" : "debug",
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

  const exportService = createExportService(
    // Until projects are indexed by id in main, exports default to Videos/Reelform.
    createElectronExportDeps({ resolveProjectDir: () => null }),
  );

  const recording = createRecordingMain({
    binDir: app.isPackaged
      ? path.join(process.resourcesPath, "bin")
      : path.join(app.getAppPath(), "electron/native/bin", `${process.platform}-${process.arch}`),
    settings: () => ({
      keepTypedText: false,
      maxLengthMs: settings.get().maxLengthHours * 3_600_000,
    }),
    targets: () => BrowserWindow.getAllWindows(),
  });

  const updater = createElectronUpdater({
    channel: settings.get().updateChannel,
    autoCheckEnabled: () => settings.get().checkUpdates,
  });
  updater.start();
  settings.subscribe((change) => {
    if (change.changed.includes("updateChannel")) updater.setChannel(change.settings.updateChannel);
  });

  registerDomain({
    "system:ping": () => ({ pong: true as const, version: app.getVersion() }),
    "system:openExternal": async ({ url }: { url: string }) => {
      await shell.openExternal(url);
      return { ok: true };
    },
  });
  registerDomain(createProjectHandlers(createElectronProjectDeps({ validate: validateProjectDocument })));
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
  registerDomain(diagnostics.handlers satisfies ReturnType<typeof createDiagnosticsHandlers>);

  windows.openLauncher();

  app.on("before-quit", () => {
    void recording.dispose();
    void exportService.cancelAll();
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
