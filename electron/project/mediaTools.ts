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

/**
 * Duration of any media file (audio-only included, unlike {@link probeVideo}):
 * the container duration, else the longest stream duration.
 */
export async function probeDurationMs(
  ff: Ffmpeg,
  abs: string,
  signal?: AbortSignal | undefined,
): Promise<number> {
  const { stdout } = await runFfmpeg(ff.runner, {
    bin: ff.bins.ffprobe,
    args: buildProbeArgs(abs),
    collectStdout: true,
    signal,
  });
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(stdout));
  } catch {
    throw new FsIpcError("TRIM_FAILED", "ffprobe output is not JSON", { path: abs });
  }
  const seconds = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
  };
  const format = isPlainObject(doc) && isPlainObject(doc.format) ? doc.format : {};
  const fromFormat = seconds(format.duration);
  if (fromFormat !== null) return fromFormat;
  const streams = isPlainObject(doc) && Array.isArray(doc.streams) ? doc.streams : [];
  let best: number | null = null;
  for (const s of streams) {
    const d = isPlainObject(s) ? seconds(s.duration) : null;
    if (d !== null && (best === null || d > best)) best = d;
  }
  if (best === null) {
    throw new FsIpcError("TRIM_FAILED", "The media file reports no duration", { path: abs });
  }
  return best;
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

export type LinkedTrackKey = (typeof LINKED_TRACK_KEYS)[number];

/** Stored `path` of every linked track present in `project.json` (missing/invalid file → none). */
export async function readLinkedTrackPaths(
  fs: FsLike,
  dir: string,
): Promise<Partial<Record<LinkedTrackKey, string>>> {
  let doc: unknown;
  try {
    doc = JSON.parse(await fs.readFile(path.join(dir, PROJECT_FILE), "utf8"));
  } catch {
    return {};
  }
  const sources = isPlainObject(doc) && isPlainObject(doc.sources) ? doc.sources : {};
  const out: Partial<Record<LinkedTrackKey, string>> = {};
  for (const k of LINKED_TRACK_KEYS) {
    const src = sources[k];
    if (isPlainObject(src)) out[k] = typeof src.path === "string" ? src.path : "";
  }
  return out;
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
