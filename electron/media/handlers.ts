import type { z } from "zod";
import { buildThumbnailArgs } from "./args";
import type { MediaContracts } from "./contracts";
import { MediaError } from "./errors";
import type { FfmpegPaths } from "./ffmpegPaths";
import { buildProbeArgs, parseProbeJson } from "./probe";
import type { MediaRootRegistry } from "./roots";
import { type RunnerDeps, runFfmpeg } from "./runner";
import { isValidRootId, mediaRootUrl } from "./url";

/**
 * IPC handlers for the media domain. Pure factory: filesystem, id generation,
 * binary lookup and process spawning come in through {@link MediaDeps}.
 */

export interface MediaDeps {
  registry: MediaRootRegistry;
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<{ isDirectory: boolean; isFile: boolean }>;
  isAbsolute(p: string): boolean;
  /** Fresh root id (must satisfy {@link isValidRootId}). */
  makeRootId(): string;
  /** Resolved lazily so a missing binary only fails the calls that need it. */
  resolveBinaries(): FfmpegPaths | null;
  runner: RunnerDeps;
}

export type MediaHandlers = {
  [K in keyof MediaContracts]: (
    req: z.infer<MediaContracts[K]["request"]>,
  ) => Promise<z.infer<MediaContracts[K]["response"]>>;
};

/** Thumbnails are small; cap stdout well below the default. */
const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;
const MAX_ID_ATTEMPTS = 16;

export function createMediaHandlers(deps: MediaDeps): MediaHandlers {
  const binaries = (): FfmpegPaths => {
    const bins = deps.resolveBinaries();
    if (!bins) throw new MediaError("FFMPEG_NOT_FOUND", "ffmpeg/ffprobe binaries not found");
    return bins;
  };
  const requireAbsolute = (p: string): void => {
    if (!deps.isAbsolute(p))
      throw new MediaError("MEDIA_PATH_NOT_ABSOLUTE", "Path must be absolute");
  };

  return {
    "media:registerRoot": async ({ path, rootId }) => {
      if (!deps.isAbsolute(path)) {
        throw new MediaError("MEDIA_ROOT_NOT_ABSOLUTE", "Media root must be an absolute path");
      }
      let realPath: string;
      let isDirectory: boolean;
      try {
        realPath = await deps.realpath(path);
        ({ isDirectory } = await deps.stat(realPath));
      } catch {
        throw new MediaError("MEDIA_ROOT_NOT_FOUND", "Media root does not exist");
      }
      if (!isDirectory)
        throw new MediaError("MEDIA_ROOT_NOT_DIRECTORY", "Media root is not a directory");

      // Re-registering the same folder reuses its id so existing URLs stay valid.
      let id = rootId ?? deps.registry.list().find((r) => r.realPath === realPath)?.id;
      for (let attempt = 0; id === undefined && attempt < MAX_ID_ATTEMPTS; attempt++) {
        const candidate = deps.makeRootId();
        if (!isValidRootId(candidate)) {
          throw new MediaError("MEDIA_INVALID_ROOT_ID", `Generated invalid root id: ${candidate}`);
        }
        if (!deps.registry.get(candidate)) id = candidate;
      }
      if (id === undefined) {
        throw new MediaError("MEDIA_INVALID_ROOT_ID", "Could not allocate a unique root id");
      }
      deps.registry.add({ id, realPath });
      return { rootId: id, baseUrl: mediaRootUrl(id) };
    },

    "media:unregisterRoot": async ({ rootId }) => ({ ok: deps.registry.remove(rootId) }),

    "media:probe": async ({ path }) => {
      requireAbsolute(path);
      const { ffprobe } = binaries();
      const { stdout } = await runFfmpeg(deps.runner, {
        bin: ffprobe,
        args: buildProbeArgs(path),
        collectStdout: true,
      });
      return parseProbeJson(new TextDecoder().decode(stdout));
    },

    "media:thumbnail": async ({ path, atMs, width, format }) => {
      requireAbsolute(path);
      const { ffmpeg } = binaries();
      const fmt = format ?? "png";
      const { stdout } = await runFfmpeg(deps.runner, {
        bin: ffmpeg,
        args: buildThumbnailArgs({ input: path, atMs, width, format: fmt }),
        collectStdout: true,
        maxStdoutBytes: THUMBNAIL_MAX_BYTES,
      });
      if (stdout.byteLength === 0) {
        throw new MediaError("MEDIA_THUMBNAIL_FAILED", "No frame at the requested time");
      }
      const mime = fmt === "png" ? "image/png" : "image/jpeg";
      return { dataUrl: `data:${mime};base64,${Buffer.from(stdout).toString("base64")}` };
    },
  };
}
