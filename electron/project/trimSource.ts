import * as path from "node:path";
import { type TimeRange, trimCopyArgs, trimWindow } from "../media/args";
import { runFfmpeg } from "../media/runner";
import { atomicWriteFile } from "./atomicWrite";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import {
  type FfmpegDeps,
  causeCode,
  probeVideo,
  readLinkedTracks,
  requireFfmpeg,
  resolveVideoSource,
  toPosix,
} from "./mediaTools";
import { MEDIA_DIR, pathExists, resolveWithinSync, splitExt, uniqueName } from "./paths";

/**
 * "Trim source to used range" (§9.9): `-c copy` cut with 1s handles into
 * `media/`, original moved to `<project>/.trash/<token>/` so the edit can be
 * undone until the app quits ({@link purgeTrimTrash}).
 */

/** Per-project undo area for trimmed originals (not the library `.trash`). */
export const TRIM_TRASH_DIR = ".trash";
export const TRIM_MANIFEST = "manifest.json";
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface ClipLike {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  [key: string]: unknown;
}

export interface TrimDeps {
  fs: FsLike;
  ffmpeg?: FfmpegDeps | undefined;
  /** Undo token (must match `[A-Za-z0-9_-]{1,128}`). */
  newToken: () => string;
  now: () => number;
  /** Called after an original lands in a project's trim trash (quit-time purge list). */
  onTrashed?: ((projectDir: string) => void) | undefined;
}

export interface TrimRequest {
  usedRange: TimeRange;
  /** Override for `sources.video.path` (project-relative). */
  videoPath?: string | undefined;
  clips?: readonly ClipLike[] | undefined;
  /** Caller shifts mic/system/webcam/telemetry by `offsetMs`; otherwise TRIM_LINKED_TRACKS. */
  allowLinkedTracks?: boolean | undefined;
}

export interface TrimResponse {
  clips: ClipLike[];
  /** New project-relative (posix) video path. */
  videoPath: string;
  videoDurationMs: number;
  savedBytes: number;
  /** Subtract from every clip's source times. */
  offsetMs: number;
  undoToken: string;
}

interface TrimManifest {
  version: 1;
  originalPath: string;
  trimmedPath: string;
  createdAt: string;
}

/**
 * Stream copy cannot start mid-GOP: the cut begins at the keyframe before
 * `window.startMs`, so the output is longer than asked by that lead-in. The
 * real offset is the requested start minus the lead-in (never negative).
 */
export function estimateTrimOffsetMs(window: TimeRange, outputDurationMs: number): number {
  const requested = window.endMs - window.startMs;
  const leadIn = Number.isFinite(outputDurationMs) ? Math.max(0, outputDurationMs - requested) : 0;
  return Math.round(Math.max(0, window.startMs - leadIn));
}

export function rewriteClips(clips: readonly ClipLike[], offsetMs: number): ClipLike[] {
  return clips.map((c) => ({
    ...c,
    sourceStartMs: Math.max(0, c.sourceStartMs - offsetMs),
    sourceEndMs: Math.max(0, c.sourceEndMs - offsetMs),
  }));
}

const failed = (message: string, err: unknown): FsIpcError =>
  err instanceof FsIpcError
    ? err
    : new FsIpcError("TRIM_FAILED", message, {
        cause: causeCode(err) ?? errnoCode(err),
        message: err instanceof Error ? err.message : String(err),
      });

export async function trimSource(
  deps: TrimDeps,
  dir: string,
  req: TrimRequest,
): Promise<TrimResponse> {
  const { fs } = deps;
  const ff = requireFfmpeg(deps.ffmpeg);
  const src = await resolveVideoSource(fs, dir, req.videoPath);
  if (!src.inProject) {
    throw new FsIpcError("INVALID_PATH", "Only media inside the project can be trimmed", {
      path: src.stored,
    });
  }
  // The original is purged at quit, so a desync of linked tracks would be permanent.
  const linked = req.allowLinkedTracks ? [] : await readLinkedTracks(fs, dir);
  if (linked.length > 0) {
    throw new FsIpcError(
      "TRIM_LINKED_TRACKS",
      "This recording has audio, webcam or cursor tracks that trimming would put out of sync",
      { tracks: linked },
    );
  }

  let window: TimeRange;
  let sourceDurationMs: number;
  try {
    sourceDurationMs = (await probeVideo(ff, src.abs)).durationMs;
    window = trimWindow(req.usedRange, sourceDurationMs);
  } catch (err) {
    throw failed("Could not read the video source", err);
  }
  if (window.startMs <= 0 && window.endMs >= sourceDurationMs) {
    throw new FsIpcError("TRIM_NOTHING_TO_SAVE", "The whole source is in use", {
      usedRange: req.usedRange,
    });
  }

  const mediaDir = path.join(dir, MEDIA_DIR);
  await fs.mkdir(mediaDir, { recursive: true });
  const { stem, ext } = splitExt(path.basename(src.abs));
  const outExt = ext === "" ? ".mp4" : ext;
  const token = deps.newToken();
  if (!TOKEN_RE.test(token)) throw new Error(`newToken() returned an unusable token: ${token}`);
  const tempPath = path.join(mediaDir, `.${stem}.trim-${token}.partial${outExt}`);

  let outputAbs: string;
  let videoDurationMs: number;
  let outputSize: number;
  try {
    const { args } = trimCopyArgs({
      input: src.abs,
      output: tempPath,
      used: req.usedRange,
      sourceDurationMs,
    });
    await runFfmpeg(ff.runner, { bin: ff.bins.ffmpeg, args });
    videoDurationMs = (await probeVideo(ff, tempPath)).durationMs;
    outputSize = (await fs.stat(tempPath)).size;
    const name = await uniqueName(`${stem}-trimmed${outExt}`, (c) =>
      pathExists(fs, path.join(mediaDir, c)),
    );
    outputAbs = path.join(mediaDir, name);
    await fs.rename(tempPath, outputAbs);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw failed("Could not trim the video source", err);
  }

  const trimmedPath = toPosix(path.relative(dir, outputAbs));
  const trashDir = path.join(dir, TRIM_TRASH_DIR, token);
  try {
    await fs.mkdir(trashDir, { recursive: true });
    const manifest: TrimManifest = {
      version: 1,
      originalPath: src.stored,
      trimmedPath,
      createdAt: new Date(deps.now()).toISOString(),
    };
    await atomicWriteFile(fs, path.join(trashDir, TRIM_MANIFEST), JSON.stringify(manifest));
    await fs.rename(src.abs, path.join(trashDir, path.basename(src.abs)));
  } catch (err) {
    await fs.rm(outputAbs, { force: true }).catch(() => undefined);
    await fs.rm(trashDir, { recursive: true, force: true }).catch(() => undefined);
    throw failed("Could not move the original into the project trash", err);
  }
  deps.onTrashed?.(dir);

  const offsetMs = estimateTrimOffsetMs(window, videoDurationMs);
  return {
    clips: rewriteClips(req.clips ?? [], offsetMs),
    videoPath: trimmedPath,
    videoDurationMs,
    savedBytes: Math.max(0, src.size - outputSize),
    offsetMs,
    undoToken: token,
  };
}

async function readManifest(fs: FsLike, trashDir: string): Promise<TrimManifest> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(trashDir, TRIM_MANIFEST), "utf8"));
    const m = raw as Partial<TrimManifest>;
    if (typeof m.originalPath === "string" && typeof m.trimmedPath === "string") {
      return {
        version: 1,
        originalPath: m.originalPath,
        trimmedPath: m.trimmedPath,
        createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
      };
    }
  } catch {
    // fall through
  }
  throw new FsIpcError("TRIM_UNDO_NOT_FOUND", "The trimmed original is no longer available");
}

/** Move a trimmed original back and remove the trimmed copy. */
export async function restoreTrimmedSource(
  deps: Pick<TrimDeps, "fs">,
  dir: string,
  undoToken: string,
): Promise<{ videoPath: string }> {
  const { fs } = deps;
  if (!TOKEN_RE.test(undoToken)) {
    throw new FsIpcError("TRIM_UNDO_NOT_FOUND", "Unknown undo token", { undoToken });
  }
  const trashDir = path.join(dir, TRIM_TRASH_DIR, undoToken);
  const manifest = await readManifest(fs, trashDir);
  const originalAbs = resolveWithinSync(dir, manifest.originalPath.split("/").join(path.sep));
  const trimmedAbs = resolveWithinSync(dir, manifest.trimmedPath.split("/").join(path.sep));
  const stashed = path.join(trashDir, path.basename(originalAbs));
  if (!(await pathExists(fs, stashed))) {
    throw new FsIpcError("TRIM_UNDO_NOT_FOUND", "The trimmed original is no longer available");
  }
  if (await pathExists(fs, originalAbs)) {
    throw new FsIpcError("TRIM_FAILED", "A file already exists where the original was", {
      path: manifest.originalPath,
    });
  }
  try {
    await fs.mkdir(path.dirname(originalAbs), { recursive: true });
    await fs.rename(stashed, originalAbs);
  } catch (err) {
    throw failed("Could not restore the original", err);
  }
  await fs.rm(trimmedAbs, { force: true }).catch(() => undefined);
  await fs.rm(trashDir, { recursive: true, force: true }).catch(() => undefined);
  return { videoPath: manifest.originalPath };
}

/** Permanently delete trimmed originals (app quit). Returns how many trash folders were removed. */
export async function purgeTrimTrash(
  projectDirs: Iterable<string>,
  fs: Pick<FsLike, "rm" | "access">,
): Promise<number> {
  let removed = 0;
  for (const dir of new Set(projectDirs)) {
    const trash = path.join(dir, TRIM_TRASH_DIR);
    try {
      await fs.access(trash);
    } catch {
      continue;
    }
    try {
      await fs.rm(trash, { recursive: true, force: true });
      removed++;
    } catch {
      // Best effort at quit; the next session's purge retries.
    }
  }
  return removed;
}
