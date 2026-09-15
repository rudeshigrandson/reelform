import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopCapturer, screen } from "electron";
import { type TrackWriter, createElectronBackend } from "./electronBackend";
import { type HelperChild, type HelperDeps, HelperProcess } from "./helperProcess";
import { verifyHelperBinary } from "./manifest";
import { SCK_HELPER_NAME, createSckBackend } from "./sckBackend";
import type { CaptureBackend, Sources } from "./types";
import { WGC_HELPER_NAME, createWgcBackend } from "./wgcBackend";

/** Thin, untested adapter: real Electron / node deps for the capture backends. */

export const nodeHelperDeps: HelperDeps = {
  // posix: own process group so killTree can signal the whole tree (-pid).
  spawn: (command, args, options) =>
    nodeSpawn(command, [...args], {
      ...options,
      detached: process.platform !== "win32",
    }) as unknown as HelperChild,
  killTree: (pid) =>
    new Promise<void>((resolve) => {
      if (process.platform === "win32") {
        nodeSpawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on(
          "exit",
          () => resolve(),
        );
        return;
      }
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      resolve();
    }),
  timers: {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
};

export async function electronSources(): Promise<Sources> {
  const caps = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  const displays = screen.getAllDisplays().map((d, i) => {
    const src =
      caps.find((s) => s.display_id === String(d.id)) ??
      caps.filter((s) => s.id.startsWith("screen:"))[i];
    return {
      id: String(d.id),
      name: d.label || `Display ${i + 1}`,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      thumbnail: src?.thumbnail.toDataURL(),
      mediaSourceId: src?.id,
    };
  });
  const windows = caps
    .filter((s) => s.id.startsWith("window:"))
    .map((s) => ({
      id: s.id,
      title: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon?.toDataURL(),
    }));
  return { displays, windows };
}

export interface CaptureAdapterOptions {
  /** Directory containing `<platform-arch>/manifest.json` + helper binaries. */
  binDir: string;
}

export function createCaptureBackends(opts: CaptureAdapterOptions): CaptureBackend[] {
  const platformArch = `${process.platform}-${process.arch}`;
  const verifyDeps = {
    readFile: async (p: string) => new Uint8Array(await readFile(p)),
    sha256: (b: Uint8Array) => createHash("sha256").update(b).digest("hex"),
    join,
  };
  const native = (name: string) => ({
    currentPlatform: process.platform,
    verify: () => verifyHelperBinary({ binDir: opts.binDir, platformArch, name }, verifyDeps),
    createHelper: (path: string) => new HelperProcess({ command: path }, nodeHelperDeps),
    join,
  });
  const writer = async (path: string): Promise<TrackWriter> => {
    const fh = await open(path, "w");
    return {
      write: async (bytes) => {
        await fh.write(bytes);
      },
      close: () => fh.close(),
    };
  };
  return [
    createSckBackend(native(SCK_HELPER_NAME)),
    createWgcBackend(native(WGC_HELPER_NAME)),
    createElectronBackend({
      getSources: electronSources,
      openWriter: writer,
      join,
      // close() waits for the renderer to end every track (`recording:endTrack`).
      timers: nodeHelperDeps.timers,
    }),
  ];
}
