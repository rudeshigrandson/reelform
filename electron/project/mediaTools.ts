import * as path from "node:path";
import type { FfmpegPaths } from "../media/ffmpegPaths";
import { type ProbeResult, buildProbeArgs, parseProbeJson } from "../media/probe";
import { type RunnerDeps, runFfmpeg } from "../media/runner";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import { PROJECT_FILE, resolveWithin } from "./paths";

/**
 * Shared ffmpeg + project-source plumbing for the main-process media jobs that
 * live in the project domain (trim, proxy, filmstrip) and the export mux step.
 */

export interface FfmpegDeps {
  runner: RunnerDeps;
  /** Resolved lazily so a missing binary only fails the calls that need it. */
  resolveBinaries: () => FfmpegPaths | null;
}

export interface Ffmpeg {
  runner: RunnerDeps;
  bins: FfmpegPaths;
}

export function requireFfmpeg(deps: FfmpegDeps | undefined): Ffmpeg {
  const bins = deps?.resolveBinaries() ?? null;
  if (!deps || !bins) {
    throw new FsIpcError("FFMPEG_UNAVAILABLE", "ffmpeg is not available on this device");
  }
  return { runner: deps.runner, bins };
}

export async function probeVideo(
  ff: Ffmpeg,
  abs: string,
  signal?: AbortSignal | undefined,
): Promise<ProbeResult> {
  const { stdout } = await runFfmpeg(ff.runner, {
    bin: ff.bins.ffprobe,
    args: buildProbeArgs(abs),
    collectStdout: true,
    signal,
  });
  return parseProbeJson(new TextDecoder().decode(stdout));
}

export interface VideoSource {
  /** Value stored in `sources.video.path` (project-relative posix, or absolute). */
  stored: string;
  abs: string;
  /** False for absolute references outside the project folder. */
  inProject: boolean;
  size: number;
  mtimeMs: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `sources.video.path` from `project.json`. */
export async function readVideoSourcePath(fs: FsLike, dir: string): Promise<string> {
  let doc: unknown;
  try {
    doc = JSON.parse(await fs.readFile(path.join(dir, PROJECT_FILE), "utf8"));
  } catch (e) {
    const code = errnoCode(e);
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new FsIpcError("PROJECT_NOT_FOUND", "project.json not found", { path: dir });
    }
    throw new FsIpcError("PROJECT_CORRUPT", "project.json is not valid JSON", { path: dir });
  }
  const p =
    isPlainObject(doc) && isPlainObject(doc.sources) && isPlainObject(doc.sources.video)
      ? doc.sources.video.path
      : undefined;
  if (typeof p !== "string" || p === "") {
    throw new FsIpcError("SOURCE_NOT_FOUND", "The project has no video source", { path: dir });
  }
  return p;
}

/** Sources that share the screen video's source timebase. */
export const LINKED_TRACK_KEYS = ["mic", "system", "webcam", "telemetry"] as const;

/** Linked tracks present in `project.json` (a missing/invalid file reports none). */
export async function readLinkedTracks(fs: FsLike, dir: string): Promise<string[]> {
  let doc: unknown;
  try {
    doc = JSON.parse(await fs.readFile(path.join(dir, PROJECT_FILE), "utf8"));
  } catch {
    return [];
  }
  const sources = isPlainObject(doc) && isPlainObject(doc.sources) ? doc.sources : {};
  return LINKED_TRACK_KEYS.filter((k) => isPlainObject(sources[k]));
}

/** Resolve the project's video source (or `override`) and stat it. */
export async function resolveVideoSource(
  fs: FsLike,
  dir: string,
  override?: string | undefined,
): Promise<VideoSource> {
  const stored = override ?? (await readVideoSourcePath(fs, dir));
  const absolute = path.isAbsolute(stored) || /^[a-zA-Z]:[\\/]/.test(stored);
  if (stored.includes("\0")) {
    throw new FsIpcError("INVALID_PATH", "Path contains a NUL byte");
  }
  const abs = absolute
    ? path.resolve(stored)
    : await resolveWithin(fs, dir, stored.split("/").join(path.sep));
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    return { stored, abs, inProject: !absolute, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    throw new FsIpcError("SOURCE_NOT_FOUND", "The video source is missing", { path: stored });
  }
}

export const toPosix = (p: string): string => p.split(path.sep).join("/");

/** Code of a thrown MediaError/FsIpcError/errno error, for error details. */
export function causeCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
