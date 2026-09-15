import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { gzip as zGzip } from "node:zlib";
import { type BrowserWindow, app, screen, systemPreferences } from "electron";
import { createCaptureBackends, nodeHelperDeps } from "../capture/electronAdapter";
import type { BackendId } from "../capture/types";
import { type FinalizeResponse, type RecordingEvent, recordingEvents } from "./contracts";
import {
  type RecordingController,
  type RecordingSettings,
  createRecordingController,
} from "./controller";
import { createCursorPollHook } from "./cursorPollHook";
import type { InputHook } from "./telemetry";
import { type WebmFileOps, fixWebmDurationFile } from "./webmDurationFile";

/** Thin, untested adapter: wires the recording controller to Electron + node. */

/** Node file ops for the WebM duration patch (head rewrite streams the rest). */
export const nodeWebmFileOps: WebmFileOps = {
  readHead: async (path, maxBytes) => {
    const fh = await open(path, "r");
    try {
      const buf = new Uint8Array(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  },
  writeHead: async (path, bytes) => {
    const fh = await open(path, "r+");
    try {
      await fh.write(bytes, 0, bytes.length, 0);
    } finally {
      await fh.close();
    }
  },
  replaceHead: async (path, replacedBytes, head) => {
    const tmp = `${path}.duration.tmp`;
    try {
      const out = createWriteStream(tmp);
      out.write(head);
      await pipeline(createReadStream(path, { start: replacedBytes }), out);
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  },
};

const gzipAsync = promisify(zGzip);

export interface RecordingMainOptions {
  binDir: string;
  settings(): RecordingSettings;
  /** Windows that receive `recording:event` (launcher, HUD, editor). */
  targets(): BrowserWindow[];
  /** Main-process observer of every `recording:event` (e.g. the tray). */
  onEvent?: ((event: RecordingEvent) => void) | undefined;
  /**
   * After finalize. Main-shell: `composePostProcess(remux, thumbnail, transcode)`
   * from remuxPostProcess.ts / thumbnailPostProcess.ts / transcodeJob.ts.
   */
  postProcess?: ((res: FinalizeResponse) => Promise<FinalizeResponse>) | undefined;
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
    postProcess: opts.postProcess,
    fixWebmDuration: async (path, durationMs) => {
      await fixWebmDurationFile(nodeWebmFileOps, path, durationMs);
    },
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
