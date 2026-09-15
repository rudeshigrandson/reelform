import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, promises as fsp } from "node:fs";
import * as nodePath from "node:path";
import { Readable } from "node:stream";
import { app, protocol } from "electron";
import { resolveFfmpegPaths } from "./ffmpegPaths";
import type { MediaDeps } from "./handlers";
import { createMediaProtocolHandler } from "./protocolHandler";
import type { MediaRootRegistry } from "./roots";
import type { RunnerDeps } from "./runner";
import { MEDIA_SCHEME } from "./url";

/**
 * Thin Electron glue for the media domain (untested; all logic lives in the
 * pure modules). Call {@link registerMediaSchemePrivileges} before `app` is
 * ready, {@link installMediaProtocol} after.
 */

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        bypassCSP: true,
      },
    },
  ]);
}

export const nodeRunnerDeps: RunnerDeps = {
  spawn: (command, args) =>
    spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
};

export function createElectronMediaDeps(registry: MediaRootRegistry): MediaDeps {
  return {
    registry,
    realpath: (p) => fsp.realpath(p),
    stat: async (p) => {
      const s = await fsp.stat(p);
      return { isDirectory: s.isDirectory(), isFile: s.isFile() };
    },
    isAbsolute: (p) => nodePath.isAbsolute(p),
    makeRootId: () => `r-${randomBytes(6).toString("hex")}`,
    resolveBinaries: () =>
      resolveFfmpegPaths({
        platform: process.platform,
        arch: process.arch,
        appPath: app.getAppPath(),
        resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
        env: process.env,
        exists: existsSync,
      }),
    runner: nodeRunnerDeps,
  };
}

/** Register the `reelform-media://` handler on the default session. */
export function installMediaProtocol(registry: MediaRootRegistry): void {
  const handler = createMediaProtocolHandler<Readable>({
    registry,
    realpath: (p) => fsp.realpath(p),
    stat: async (p) => {
      const s = await fsp.stat(p);
      return { size: s.size, isFile: s.isFile() };
    },
    createReadStream: (p, start, end) => createReadStream(p, { start, end }),
  });
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const res = await handler(request);
    // Node's web stream type differs nominally from the DOM lib's; same runtime object.
    const body = res.body
      ? (Readable.toWeb(res.body) as unknown as ReadableStream<Uint8Array>)
      : null;
    return new Response(body, { status: res.status, headers: res.headers });
  });
}
