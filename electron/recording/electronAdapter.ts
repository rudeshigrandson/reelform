import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { gzip as zGzip } from "node:zlib";
import { type BrowserWindow, app, screen, systemPreferences } from "electron";
import { createCaptureBackends, nodeHelperDeps } from "../capture/electronAdapter";
import type { BackendId } from "../capture/types";
import { type RecordingEvent, recordingEvents } from "./contracts";
import {
  type RecordingController,
  type RecordingSettings,
  createRecordingController,
} from "./controller";
import { createCursorPollHook } from "./cursorPollHook";
import type { InputHook } from "./telemetry";

/** Thin, untested adapter: wires the recording controller to Electron + node. */

const gzipAsync = promisify(zGzip);

export interface RecordingMainOptions {
  binDir: string;
  settings(): RecordingSettings;
  /** Windows that receive `recording:event` (launcher, HUD, editor). */
  targets(): BrowserWindow[];
  /** Main-process observer of every `recording:event` (e.g. the tray). */
  onEvent?: ((event: RecordingEvent) => void) | undefined;
  recordingsDir?: string | undefined;
  /**
   * Global input hook for cursor/click/key telemetry: uiohook-napi (Win/Linux)
   * or the `reelform-cursor-monitor` bridge (mac) — wired by the composition
   * root once available. Omitted → cursor positions only, polled from
   * `screen.getCursorScreenPoint()` (no clicks/keys). `null` → no telemetry.
   */
  inputHook?: InputHook | null | undefined;
}

export function createRecordingMain(opts: RecordingMainOptions): RecordingController {
  const recordingsDir = opts.recordingsDir ?? join(app.getPath("userData"), "recordings");
  const eventName = recordingEvents["recording:event"].name;
  return createRecordingController({
    backends: createCaptureBackends({ binDir: opts.binDir }),
    platform: process.platform,
    os: `${process.platform} ${release()}`,
    appVersion: app.getVersion(),
    settings: opts.settings,
    checkPermissions: async (req) => {
      if (process.platform !== "darwin") return { ok: true };
      const missing: string[] = [];
      if (systemPreferences.getMediaAccessStatus("screen") !== "granted") missing.push("screen");
      if (req.audio.mic && systemPreferences.getMediaAccessStatus("microphone") !== "granted")
        missing.push("microphone");
      if (req.webcam && systemPreferences.getMediaAccessStatus("camera") !== "granted")
        missing.push("camera");
      return { ok: missing.length === 0, missing };
    },
    freeDiskBytes: async (dir) => {
      await mkdir(dir, { recursive: true });
      const s = await statfs(dir);
      return s.bavail * s.bsize;
    },
    recordingsDir,
    join,
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    removeDir: (p) => rm(p, { recursive: true, force: true }),
    writeFile: (p, bytes) => writeFile(p, bytes),
    fileSize: async (p) => {
      try {
        return (await stat(p)).size;
      } catch {
        return null;
      }
    },
    gzip: async (bytes) => new Uint8Array(await gzipAsync(bytes)),
    newId: () => randomUUID(),
    nowMs: () => performance.now(),
    nowIso: () => new Date().toISOString(),
    // Native helpers report mach_absolute_time / QPC converted to ns, the same
    // source libuv's hrtime uses; the Electron backend aligns on epoch ns.
    hostNowNs: (backend: BackendId) =>
      backend === "electron"
        ? BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n
        : process.hrtime.bigint(),
    timers: nodeHelperDeps.timers,
    emit: (event: RecordingEvent) => {
      for (const w of opts.targets()) if (!w.isDestroyed()) w.webContents.send(eventName, event);
      opts.onEvent?.(event);
    },
    inputHook:
      opts.inputHook !== undefined
        ? opts.inputHook
        : createCursorPollHook({
            getCursorPoint: () => screen.getCursorScreenPoint(),
            timers: nodeHelperDeps.timers,
          }),
    onDisplayRemoved: (listener) => {
      const h = (_e: unknown, d: Electron.Display) => listener(String(d.id));
      screen.on("display-removed", h);
      return () => screen.off("display-removed", h);
    },
  });
}
