import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { arch, release, totalmem } from "node:os";
import { BrowserWindow, app, clipboard, dialog, session, shell } from "electron";
import { type CacheTargets, createCacheOps } from "./cache";
import { createDiagnosticsHandlers } from "./contracts";
import { type LogLevel, type Logger, createLogger } from "./logger";
import { createScrubber } from "./scrub";

/** Thin Electron wiring for the logger and "Copy diagnostics" (untested). */
export function createElectronDiagnostics(opts: {
  level: LogLevel;
  getSettings: () => Readonly<Record<string, unknown>>;
  pathKeys: readonly string[];
  /** `.reelform` folders whose `cache/` is regenerable (library + recents). */
  listProjectDirs?: (() => Promise<string[]>) | undefined;
  /** App-level folders whose contents are all regenerable. */
  extraCacheDirs?: string[] | undefined;
}): { logger: Logger; handlers: ReturnType<typeof createDiagnosticsHandlers> } {
  const cacheOps = createCacheOps({
    readdir: (dir, o) => readdir(dir, o),
    lstat: (p) => lstat(p),
    rm: (p, o) => rm(p, o),
  });
  const cacheTargets = async (): Promise<CacheTargets> => ({
    projectDirs: (await opts.listProjectDirs?.().catch(() => [])) ?? [],
    extraCacheDirs: opts.extraCacheDirs,
  });
  let userName: string | undefined;
  try {
    userName = userInfo().username;
  } catch {
    userName = undefined;
  }
  const scrub = createScrubber({ homeDir: homedir(), userName });
  const logger = createLogger({
    now: () => Date.now(),
    scrub,
    level: opts.level,
    sink: (e) => {
      const line = `[${e.scope || "main"}] ${e.message}`;
      if (e.level === "error") console.error(line);
      else if (e.level === "warn") console.warn(line);
      else console.log(line);
    },
  });

  const handlers = createDiagnosticsHandlers({
    now: () => Date.now(),
    scrub,
    pathKeys: opts.pathKeys,
    clipboard,
    onError: (e) => logger.error("system utility failed", e),
    system: {
      // shell.openPath resolves "" on success, an error message otherwise.
      openLogsFolder: async () => {
        const dir = app.getPath("logs");
        // The folder only exists once something wrote to it; openPath fails on a missing path.
        await mkdir(dir, { recursive: true });
        return (await shell.openPath(dir)) === "";
      },
      cacheSize: () => session.defaultSession.getCacheSize(),
      cacheBreakdown: async () => {
        const [sessionBytes, local] = await Promise.all([
          session.defaultSession.getCacheSize().catch(() => null),
          cacheOps.sumCache(await cacheTargets()),
        ]);
        return { sessionBytes, ...local };
      },
      clearCache: async () => {
        await session.defaultSession.clearCache();
        const res = await cacheOps.clearCache(await cacheTargets(), { includeBackups: false });
        if (res.failed.length > 0) {
          logger.warn("some cache entries could not be removed", { count: res.failed.length });
        }
      },
      pickFolder: async ({ title, defaultPath }) => {
        const options: Electron.OpenDialogOptions = {
          properties: ["openDirectory", "createDirectory"],
          ...(title ? { title } : {}),
          ...(defaultPath ? { defaultPath } : {}),
        };
        const parent = BrowserWindow.getFocusedWindow();
        const res = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options);
        return res.canceled ? null : (res.filePaths[0] ?? null);
      },
    },
    collect: async () => ({
      app: {
        name: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron ?? "",
        chrome: process.versions.chrome ?? "",
        node: process.versions.node,
        packaged: app.isPackaged,
      },
      os: {
        platform: process.platform,
        release: release(),
        arch: arch(),
        locale: app.getLocale(),
        totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
      },
      gpu: {
        featureStatus: app.getGPUFeatureStatus(),
        info: await app.getGPUInfo("basic").catch(() => null),
      },
      settings: opts.getSettings(),
      logs: logger.entries(),
    }),
  });
  return { logger, handlers };
}
