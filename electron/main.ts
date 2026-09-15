import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { BrowserWindow, app, session, shell } from "electron";
import { migrate } from "../src/editor/model/v1/migrations";
import { shortcutPlatformFor, toElectronAccelerator } from "../src/shortcuts/accelerator";
import { type ShortcutOverrides, resolveShortcuts } from "../src/shortcuts/registry";
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
import { createMediaRootRegistry, isInsideRoot } from "./media/roots";
import {
  CURSOR_MONITOR_HELPER_NAME,
  createCursorMonitorBridge,
} from "./native/mac/cursorMonitorBridge";
import { createPermissionsHandlers } from "./permissions/contracts";
import { createElectronPermissionsDeps } from "./permissions/electronAdapter";
import { createProjectHandlers } from "./project";
import type { ProjectListEntry } from "./project/contracts";
import { createElectronProjectDeps } from "./project/electronAdapter";
import { documentId } from "./project/handlers";
import { purgeTrimTrash } from "./project/trimSource";
import type { RecordingEvent } from "./recording/contracts";
import { createRecordingMain } from "./recording/electronAdapter";
import { isAttachedToProject, pruneRecordings } from "./recording/prune";
import { createRemuxPostProcess } from "./recording/remuxPostProcess";
import { composePostProcess, createThumbnailPostProcess } from "./recording/thumbnailPostProcess";
import { installWebContentsHardening, isAllowedExternalUrl } from "./security/hardening";
import { backendOverrideFor } from "./settings/captureBackend";
import { createSettingsHandlers } from "./settings/contracts";
import { createElectronSettings } from "./settings/electronAdapter";
import { routeGlobalShortcut, shortcutContextForRecordingEvent } from "./settings/globalShortcuts";
import { createSystemFileHandlers } from "./system";
import { createElectronSystemDeps } from "./system/electronAdapter";
import { createPickedPathRegistry } from "./system/pickedPaths";
import { createProjectFileHandlers } from "./system/projectFiles";
import { createNodeProjectFileDeps, isInsideProjectFolder } from "./system/projectFilesNode";
import { createTelemetryHandlers } from "./telemetry/handlers";
import { type TrayController, createElectronTray } from "./tray/electronAdapter";
import {
  IDLE_TRAY_RECORDING,
  type TrayRecording,
  reduceTrayRecording,
  trayActionCommand,
} from "./tray/recordingTray";
import type { RecentProject, TrayAction, TrayState } from "./tray/trayMenu";
import { createUpdaterHandlers } from "./updater/contracts";
import { createElectronUpdater } from "./updater/electronAdapter";
import { createWindowsHandlers } from "./windows/contracts";
import { createElectronWindowManager } from "./windows/electronAdapter";
import { createFileHudPositionStore } from "./windows/hudPosition";
import {
  DEEP_LINK_SCHEME,
  type PlatformName,
  createLaunchIntentQueue,
  dispatchLaunchIntents,
  parseDeepLink,
  parseLaunchArgs,
  parseOpenFile,
} from "./windows/launchArgs";

/**
 * Main-process composition root (SPEC §2): builds every domain's handlers from
 * its Electron adapter and registers them against the merged contracts. Domain
 * logic lives in `electron/<domain>/`; this file only wires deps together.
 */

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(here, "preload.cjs");
const indexHtmlPath = path.join(here, "../dist/index.html");
const platformArch = `${process.platform}-${process.arch}`;
const launchPlatform: PlatformName =
  process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";

const PROJECT_REFRESH_MS = 60_000;
const PRUNE_INTERVAL_MS = 24 * 3_600_000;

// Must run before `app.ready` so reelform-media:// can stream and bypass CSP.
registerMediaSchemePrivileges();

/** Files / deep links handed to the app before boot finished (macOS delivers these early). */
const launchQueue = createLaunchIntentQueue();

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

const realOrNull = (p: string): Promise<string | null> => realpath(p).catch(() => null);

async function isInsideAny(roots: readonly string[], candidate: string): Promise<boolean> {
  for (const root of roots) {
    const real = await realOrNull(root);
    if (real !== null && isInsideRoot(real, candidate)) return true;
  }
  return false;
}

/** Tray accelerators for start/stop and pause from the user's shortcut overrides ("" = unbound). */
function trayAccelerators(
  overrides: ShortcutOverrides,
): Pick<TrayState, "startStopAccelerator" | "pauseAccelerator"> {
  const platform = shortcutPlatformFor(process.platform);
  const resolved = resolveShortcuts(platform, overrides);
  const electron = (id: string): string => {
    const acc = resolved.find((r) => r.id === id)?.accelerator;
    return acc ? toElectronAccelerator(acc, platform) : "";
  };
  return {
    startStopAccelerator: electron("record.toggle"),
    pauseAccelerator: electron("record.pause"),
  };
}

async function boot(): Promise<void> {
  // Before any window exists: every webContents gets navigation/permission guards (§13).
  installWebContentsHardening({
    app,
    session: session.defaultSession,
    shell,
    allowedOrigins: DEV_URL ? [new URL(DEV_URL).origin] : [pathToFileURL(indexHtmlPath).href],
    log: (message) => console.warn(`[security] ${message}`),
  });

  // Global shortcuts route through here once windows exist (see below).
  let onGlobalShortcut = (id: string): void => broadcast("shortcuts:triggered", { id });
  const { store: settings, shortcuts } = createElectronSettings((id) => onGlobalShortcut(id));
  await settings.load();

  const userData = app.getPath("userData");
  /** Recording session temp/out root; matches `createRecordingMain`'s default. */
  const recordingsRoot = path.join(userData, "recordings");

  const projectHandlers = createProjectHandlers(
    createElectronProjectDeps({ validate: validateProjectDocument }),
  );

  // Library + recents snapshot: tray Recent, path policies, trim-trash purge on quit.
  let projectEntries: ProjectListEntry[] = [];
  let projectsRefresh: Promise<void> | null = null;
  let refreshAgain = false;
  /** Coalesced `project:list`; a call during an in-flight list re-runs it so changes are never missed. */
  const refreshProjects = (): Promise<void> => {
    if (projectsRefresh) {
      refreshAgain = true;
      return projectsRefresh;
    }
    projectsRefresh = (async () => {
      do {
        refreshAgain = false;
        try {
          const { projects } = await projectHandlers["project:list"]({});
          projectEntries = projects;
          tray?.update(trayState());
        } catch (err) {
          console.warn("[main] project list failed", err);
        }
      } while (refreshAgain);
    })().finally(() => {
      projectsRefresh = null;
    });
    return projectsRefresh;
  };
  const knownProjectDirs = (): string[] =>
    projectEntries.filter((p) => !p.missing).map((p) => p.path);
  const recentProjects = (): RecentProject[] =>
    projectEntries
      .filter((p): p is ProjectListEntry & { id: string } => p.recent && !p.missing && !!p.id)
      .map((p) => ({ projectId: p.id, name: p.name }));
  /** True when `abs` lies inside a project folder the library knows (refreshing once on a miss). */
  const isKnownProjectPath = async (abs: string): Promise<boolean> => {
    const target = path.resolve(abs);
    const inside = (dirs: string[]) =>
      dirs.some((d) => path.resolve(d) !== target && isInsideRoot(path.resolve(d), target));
    let known = inside(knownProjectDirs());
    if (!known) {
      // A project created or opened since the last snapshot: refresh once before refusing.
      await refreshProjects();
      known = inside(knownProjectDirs());
    }
    // The lexical check alone would follow a symlink out of the project; require the real
    // path to still sit inside a `.reelform` folder holding project.json.
    return known && (await isInsideProjectFolder(target));
  };

  const diagnostics = createElectronDiagnostics({
    level: settings.get().logLevel,
    getSettings: () => settings.get(),
    pathKeys: ["recordingsFolder"],
    listProjectDirs: async () => {
      await refreshProjects();
      return knownProjectDirs();
    },
    extraCacheDirs: [path.join(userData, "tmp")],
  });

  const hudPositions = createFileHudPositionStore(
    path.join(userData, "hud-positions.json"),
    {
      readFile: (p) => readFile(p, "utf8"),
      writeFile: (p, d) => writeFile(p, d, "utf8"),
      rename: (a, b) => rename(a, b),
      mkdir: async (p) => {
        await mkdir(p, { recursive: true });
      },
    },
    (message) => console.warn(`[windows] ${message}`),
  );
  await hudPositions.load();

  const windows = createElectronWindowManager({
    preloadPath,
    loadSource: DEV_URL ? { type: "dev", devServerUrl: DEV_URL } : { type: "file", indexHtmlPath },
    hudPositions,
    onHudVisibilityChange: (open) => shortcuts.setContext({ hudOpen: open }),
  });

  onGlobalShortcut = (id) => {
    const context = shortcuts.getStatus().context;
    const route = routeGlobalShortcut(id, {
      hudOpen: windows.isHudOpen(),
      sessionActive: context.recording || context.countdown,
    });
    if (route === "open-hud") windows.openHud();
    else broadcast("shortcuts:triggered", { id });
  };

  const mediaRoots = createMediaRootRegistry();
  installMediaProtocol(mediaRoots);
  const mediaDeps = createElectronMediaDeps(mediaRoots, {
    // A renderer may only register project folders, the recordings folder or session output.
    isRootAllowed: async (realDir) => {
      try {
        if ((await stat(path.join(realDir, "project.json"))).isFile()) return true;
      } catch {
        // No project marker; fall through to the recording roots.
      }
      return isInsideAny([settings.get().recordingsFolder, recordingsRoot], realDir);
    },
  });
  const ffmpeg = { runner: nodeRunnerDeps, resolveBinaries: mediaDeps.resolveBinaries };

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

  // Tray mirrors the live recording session (red dot, Pause/Resume/Stop).
  let tray: TrayController | null = null;
  let trayRecording: TrayRecording = IDLE_TRAY_RECORDING;
  const trayState = (): TrayState => ({
    recording: trayRecording.state,
    recent: recentProjects(),
    ...trayAccelerators(settings.get().shortcuts),
  });
  const onRecordingEvent = (event: RecordingEvent): void => {
    // Global shortcuts are live while HUD open / recording / countdown (§5.6).
    const context = shortcutContextForRecordingEvent(event.type);
    if (context) shortcuts.setContext(context);
    const next = reduceTrayRecording(trayRecording, event);
    if (next === trayRecording) return;
    trayRecording = next;
    tray?.update(trayState());
  };
  const sessionActive = (): boolean => {
    const context = shortcuts.getStatus().context;
    return context.recording || context.countdown || trayRecording.sessionId !== null;
  };

  const recordingLog = (message: string): void => console.warn(`[recording] ${message}`);
  const recording = createRecordingMain({
    onEvent: onRecordingEvent,
    recordingsDir: recordingsRoot,
    postProcess: composePostProcess(
      // WebM from the Electron backend has no duration/seek index: remux to MP4 when ffmpeg exists.
      createRemuxPostProcess({
        runner: nodeRunnerDeps,
        resolveBinaries: mediaDeps.resolveBinaries,
        fileSize: async (p) => {
          try {
            return (await stat(p)).size;
          } catch {
            return null;
          }
        },
        remove: (p) => rm(p, { force: true }),
        log: recordingLog,
      }),
      createThumbnailPostProcess({
        runner: nodeRunnerDeps,
        resolveBinaries: mediaDeps.resolveBinaries,
        log: recordingLog,
      }),
    ),
    binDir,
    settings: () => {
      const s = settings.get();
      return {
        keepTypedText: s.recordTypedTextBadges,
        maxLengthMs: s.maxLengthHours * 3_600_000,
        backendOverride: backendOverrideFor(s.captureBackend, process.platform),
        diskWarningThresholdGb: s.diskWarningThresholdGb,
      };
    },
    targets: () => BrowserWindow.getAllWindows(),
    inputHook: cursorBridge ?? undefined,
  });

  const updater = createElectronUpdater({
    channel: settings.get().updateChannel,
    autoCheckEnabled: () => settings.get().checkUpdates,
  });
  updater.start();

  // Auto-recording pruning (§5.6): session dirs never attached to a project, older than N days.
  const runPrune = (): void => {
    const s = settings.get();
    if (!s.autoPrune || sessionActive()) return;
    void pruneRecordings(
      {
        listSessionDirs: async () => {
          let entries: import("node:fs").Dirent[];
          try {
            entries = await readdir(recordingsRoot, { withFileTypes: true });
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw err;
          }
          const dirs: { path: string; mtimeMs: number }[] = [];
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dir = path.join(recordingsRoot, entry.name);
            try {
              dirs.push({ path: dir, mtimeMs: (await stat(dir)).mtimeMs });
            } catch {
              // Vanished between readdir and stat.
            }
          }
          return dirs;
        },
        isImported: async (dir) => isAttachedToProject(await readdir(dir)),
        removeDir: (dir) => rm(dir, { recursive: true, force: true }),
        now: () => Date.now(),
        skip: () => sessionActive(),
        log: recordingLog,
      },
      s.autoPruneDays,
    ).then((removed) => {
      if (removed.length > 0) recordingLog(`pruned ${removed.length} old recording(s)`);
    });
  };
  runPrune();
  const pruneTimer = setInterval(runPrune, PRUNE_INTERVAL_MS);

  // Tray / menu bar (§11). Recording controls are forwarded to the recording windows.
  const trayAssets = app.isPackaged
    ? path.join(process.resourcesPath, "tray")
    : path.join(app.getAppPath(), "build/tray");
  const onTrayAction = (action: TrayAction): void => {
    switch (action.type) {
      case "new-recording":
        windows.openLauncher();
        return;
      case "open-editor": {
        const latest = recentProjects()[0];
        if (latest) windows.openEditor(latest.projectId);
        else windows.openLauncher();
        return;
      }
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
      case "stop-recording": {
        const command = trayActionCommand(action.type, trayRecording);
        if (command) {
          void recording.handlers[command.channel]({ sessionId: command.sessionId }).catch(
            (err: unknown) => console.warn("[tray] recording action failed", err),
          );
        }
        return;
      }
    }
  };
  const syncTray = (show: boolean): void => {
    if (show && !tray) {
      tray = createElectronTray(
        {
          template: path.join(trayAssets, "trayTemplate.png"),
          recording: path.join(trayAssets, "trayRecording.png"),
        },
        trayState(),
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
  void refreshProjects();
  // Tray menus have no reliable "will open" hook, so Recent refreshes on a timer and on focus.
  const projectsTimer = setInterval(() => void refreshProjects(), PROJECT_REFRESH_MS);
  app.on("browser-window-focus", () => void refreshProjects());
  settings.subscribe((change) => {
    if (change.changed.includes("updateChannel")) updater.setChannel(change.settings.updateChannel);
    if (change.changed.includes("logLevel")) diagnostics.logger.setLevel(change.settings.logLevel);
    if (change.changed.includes("showInTray")) syncTray(change.settings.showInTray);
    if (change.changed.includes("launchAtLogin")) applyLoginItem(change.settings.launchAtLogin);
    if (change.changed.includes("shortcuts")) tray?.update(trayState());
    if (
      (change.changed.includes("autoPrune") || change.changed.includes("autoPruneDays")) &&
      change.settings.autoPrune
    ) {
      runPrune();
    }
  });

  const pickedPaths = createPickedPathRegistry();

  registerDomain({
    "system:ping": () => ({ pong: true as const, version: app.getVersion() }),
    "system:openExternal": async ({ url }: { url: string }) => {
      // The contract refuses other schemes too; re-check so no caller can bypass it.
      if (!isAllowedExternalUrl(url)) {
        throw Object.assign(new Error("Only https, http and mailto links can be opened"), {
          code: "EXTERNAL_URL_FORBIDDEN",
        });
      }
      await shell.openExternal(url);
      return { ok: true };
    },
  });
  // Channels that change the library/recents: refresh the snapshot (tray Recent, path policies).
  const refreshingProjectChannels = new Set([
    "project:create",
    "project:open",
    "project:rename",
    "project:moveToTrash",
    "project:restoreFromTrash",
    "project:trash",
  ]);
  registerDomain(
    Object.fromEntries(
      Object.entries(projectHandlers).map(([name, fn]) => {
        if (!refreshingProjectChannels.has(name)) return [name, fn];
        const call = fn as (payload: never) => Promise<unknown>;
        return [
          name,
          async (payload: never) => {
            const result = await call(payload);
            void refreshProjects();
            return result;
          },
        ];
      }),
    ),
  );
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
      createElectronSystemDeps({
        focusedWindow: () => BrowserWindow.getFocusedWindow(),
        pickedPaths,
      }),
    ),
  );
  // `system:pickFolder` is registered by the system domain above; ipcMain allows one handler.
  const { "system:pickFolder": _systemOwnsPickFolder, ...diagnosticsHandlers } =
    diagnostics.handlers;
  registerDomain(diagnosticsHandlers);
  registerDomain(
    createProjectFileHandlers(
      createNodeProjectFileDeps({ pickedPaths, isProjectPath: isKnownProjectPath }),
    ),
  );
  registerDomain(
    createTelemetryHandlers({
      readFile: (p) => readFile(p),
      gunzip: async (bytes) => new Uint8Array(await promisify(gunzip)(bytes)),
      realpath: (p) => realpath(p),
      path,
      resolveProjectDir: async (projectId) =>
        (await projectHandlers["project:resolve"]({ projectId })).path,
      allowedRoots: async () => {
        // The snapshot refreshes after every library change; only wait for one already running.
        if (projectsRefresh) await projectsRefresh;
        return [...knownProjectDirs(), recordingsRoot, settings.get().recordingsFolder];
      },
    }),
  );

  // Launch intents: `.reelform` files and reelform://open links (argv, open-file, open-url).
  const openProjectFile = async (projectPath: string): Promise<void> => {
    try {
      const { document } = await projectHandlers["project:open"]({ path: projectPath });
      const id = documentId(document);
      if (id) {
        windows.openEditor(id);
        void refreshProjects();
        return;
      }
    } catch (err) {
      console.warn("[main] could not open project from launch", err);
    }
    windows.openLauncher();
  };
  // argv joins what open-file/open-url queued before boot (the queue dedupes by path).
  for (const intent of parseLaunchArgs(process.argv, {
    cwd: process.cwd(),
    platform: launchPlatform,
  })) {
    launchQueue.push(intent);
  }
  if (launchQueue.pending().length === 0) windows.openLauncher();
  launchQueue.start((intent) => void openProjectFile(intent.path));

  app.on("before-quit", () => {
    clearInterval(pruneTimer);
    clearInterval(projectsTimer);
    void recording.dispose();
    void exportService.cancelAll();
    void purgeTrimTrash(
      projectEntries.filter((p) => p.recent && !p.missing).map((p) => p.path),
      { rm, access },
    );
    void hudPositions.flush();
    cursorBridge?.dispose?.();
    tray?.destroy();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.openLauncher();
  });
  app.on("second-instance", (_event, argv, workingDirectory) => {
    void dispatchLaunchIntents(
      parseLaunchArgs(argv, { cwd: workingDirectory, platform: launchPlatform }),
      { openProjectFile, focusApp: () => windows.openLauncher() },
    );
  });
}

// Single-instance lock: a second launch focuses the existing launcher.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Registered before `ready`: macOS delivers the launching file/link through these.
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    const intent = parseOpenFile(filePath, launchPlatform);
    if (intent) launchQueue.push(intent);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const intent = parseDeepLink(url, launchPlatform);
    if (intent) launchQueue.push(intent);
  });
  // Dev on Windows/Linux: register the scheme against electron + the app entry so links reach us.
  if (process.defaultApp && process.platform !== "darwin" && process.argv[1]) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
  app.whenReady().then(boot, (err: unknown) => {
    console.error("[main] boot failed", err);
    app.exit(1);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
