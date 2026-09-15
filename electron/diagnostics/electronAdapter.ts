import { mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { arch, release, totalmem } from "node:os";
import { BrowserWindow, app, clipboard, dialog, session, shell } from "electron";
import { createDiagnosticsHandlers } from "./contracts";
import { type LogLevel, type Logger, createLogger } from "./logger";
import { createScrubber } from "./scrub";

/** Thin Electron wiring for the logger and "Copy diagnostics" (untested). */
export function createElectronDiagnostics(opts: {
  level: LogLevel;
  getSettings: () => Readonly<Record<string, unknown>>;
  pathKeys: readonly string[];
}): { logger: Logger; handlers: ReturnType<typeof createDiagnosticsHandlers> } {
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
      clearCache: () => session.defaultSession.clearCache(),
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
