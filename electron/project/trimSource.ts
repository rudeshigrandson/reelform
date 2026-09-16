import * as path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { PROGRESS_PREFIX, type TimeRange, sec, trimCopyArgs, trimWindow } from "../media/args";
import { runFfmpeg } from "../media/runner";
import { atomicWriteFile } from "./atomicWrite";
import type { TrimmedLinkedTracks } from "./contracts";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import {
  type Ffmpeg,
  type FfmpegDeps,
  type LinkedTrackKey,
  causeCode,
  probeDurationMs,
  probeVideo,
  readLinkedTrackPaths,
  requireFfmpeg,
  resolveVideoSource,
  toPosix,
} from "./mediaTools";
import {
  MEDIA_DIR,
  pathExists,
  resolveWithin,
  resolveWithinSync,
  splitExt,
  uniqueName,
} from "./paths";

/**
 * "Trim source to used range" (§9.9): `-c copy` cut with 1s handles into
 * `media/`, original moved to `<project>/.trash/<token>/` so the edit can be
 * undone until the app quits ({@link purgeTrimTrash}).
 *
 * With `trimLinkedTracks`, mic/system/webcam get the same cut (stream copy when
 * it lands on the exact range, re-encode otherwise) and the telemetry file is
 * rewritten with timestamps shifted by `-offsetMs`; their originals share the
 * video's undo stash.
 */

/** Per-project undo area for trimmed originals (not the library `.trash`). */
export const TRIM_TRASH_DIR = ".trash";
export const TRIM_MANIFEST = "manifest.json";
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A stream-copied linked track may differ from the asked length by this much (keyframe lead-in). */
export const LINKED_COPY_TOLERANCE_MS = 100;

const MEDIA_TRACKS = ["mic", "system", "webcam"] as const;
type MediaTrackKey = (typeof MEDIA_TRACKS)[number];

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

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
  /** Trim mic/system/webcam and rewrite telemetry here (wins over `allowLinkedTracks`). */
  trimLinkedTracks?: boolean | undefined;
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
  /** Present when linked tracks were trimmed. */
  linked?: TrimmedLinkedTracks | undefined;
}

interface LinkedManifestEntry {
  key: LinkedTrackKey;
  originalPath: string;
  trimmedPath: string;
  /** File name inside the token's trash folder. */
  stashedName: string;
}

interface TrimManifest {
  version: 1;
  originalPath: string;
  trimmedPath: string;
  createdAt: string;
  linked?: LinkedManifestEntry[] | undefined;
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

const failed = (
  message: string,
  err: unknown,
  details: Record<string, unknown> = {},
): FsIpcError =>
  err instanceof FsIpcError
    ? err
    : new FsIpcError("TRIM_FAILED", message, {
        ...details,
        cause: causeCode(err) ?? errnoCode(err),
        message: err instanceof Error ? err.message : String(err),
      });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---- linked media cut --------------------------------------------------------

export interface LinkedCutOptions {
  input: string;
  output: string;
  /** Range of the linked file to keep (same source time as the video). */
  range: TimeRange;
  mode: "copy" | "encode";
  /** Webcam: keep a video stream; mic/system: first audio stream only. */
  hasVideo: boolean;
}

/** Codec args for a re-encode that keeps the file's container (by extension). */
function encodeCodecArgs(ext: string, hasVideo: boolean): string[] {
  const e = ext.toLowerCase();
  if (e === ".wav") return ["-c:a", "pcm_s16le"];
  if (e === ".webm" || e === ".mkv") {
    const video = hasVideo
      ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "0", "-crf", "30"]
      : [];
    return [...video, "-c:a", "libopus", "-b:a", "160k"];
  }
  if (e === ".ogg" || e === ".opus") return ["-c:a", "libopus", "-b:a", "160k"];
  const video = hasVideo
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]
    : [];
  return [...video, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
}

/** ffmpeg args cutting a linked track to `range` (stream copy or container-preserving re-encode). */
export function linkedCutArgs(o: LinkedCutOptions): string[] {
  const durationMs = o.range.endMs - o.range.startMs;
  if (!(o.range.startMs >= 0) || !(durationMs > 0)) {
    throw new FsIpcError("TRIM_FAILED", "Invalid range for a linked track", { range: o.range });
  }
  const seek = ["-ss", sec(o.range.startMs), "-i", o.input, "-t", sec(durationMs)];
  if (o.mode === "copy") {
    return [
      ...PROGRESS_PREFIX,
      ...seek,
      "-map",
      "0",
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      o.output,
    ];
  }
  const map = o.hasVideo ? ["-map", "0:v:0?", "-map", "0:a?"] : ["-map", "0:a:0"];
  return [
    ...PROGRESS_PREFIX,
    ...seek,
    ...map,
    ...encodeCodecArgs(path.extname(o.output), o.hasVideo),
    o.output,
  ];
}

interface CutResult {
  outputAbs: string;
  durationMs: number;
}

/** Cut one linked media file next to itself; the original is untouched. */
async function cutLinkedMedia(
  deps: { fs: FsLike; ff: Ffmpeg },
  key: MediaTrackKey,
  inputAbs: string,
  keep: TimeRange,
  token: string,
): Promise<CutResult> {
  const { fs, ff } = deps;
  const sourceDurationMs = await probeDurationMs(ff, inputAbs);
  const range: TimeRange = {
    startMs: Math.min(keep.startMs, sourceDurationMs),
    endMs: Math.min(keep.endMs, sourceDurationMs),
  };
  if (range.endMs - range.startMs <= 0) {
    throw new FsIpcError("TRIM_FAILED", `The ${key} track has no media in the used range`, {
      track: key,
    });
  }
  const expectedMs = range.endMs - range.startMs;
  const folder = path.dirname(inputAbs);
  const { stem, ext } = splitExt(path.basename(inputAbs));
  const tempPath = path.join(folder, `.${stem}.trim-${token}.partial${ext}`);
  const hasVideo = key === "webcam";

  let durationMs: number | null = null;
  try {
    await runFfmpeg(ff.runner, {
      bin: ff.bins.ffmpeg,
      args: linkedCutArgs({ input: inputAbs, output: tempPath, range, mode: "copy", hasVideo }),
    });
    const copied = await probeDurationMs(ff, tempPath);
    // A copy that snapped to an earlier keyframe would shift this track against the video.
    if (Math.abs(copied - expectedMs) <= LINKED_COPY_TOLERANCE_MS) durationMs = copied;
  } catch {
    durationMs = null;
  }
  try {
    if (durationMs === null) {
      await fs.rm(tempPath, { force: true });
      await runFfmpeg(ff.runner, {
        bin: ff.bins.ffmpeg,
        args: linkedCutArgs({ input: inputAbs, output: tempPath, range, mode: "encode", hasVideo }),
      });
      durationMs = await probeDurationMs(ff, tempPath);
    }
    const name = await uniqueName(`${stem}-trimmed${ext}`, (c) =>
      pathExists(fs, path.join(folder, c)),
    );
    const outputAbs = path.join(folder, name);
    await fs.rename(tempPath, outputAbs);
    return { outputAbs, durationMs };
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw failed(`Could not trim the ${key} track`, err, { track: key });
  }
}

// ---- telemetry -----------------------------------------------------------------

const TELEMETRY_SERIES = ["points", "clicks", "keys", "scrolls"] as const;

export interface ShiftedTelemetry {
  file: Record<string, unknown>;
  pointCount: number;
  hasClicks: boolean;
  hasKeys: boolean;
}

/**
 * Telemetry (§4 `telemetry.json`: `[tMs, …]` tuples) for the trimmed source:
 * entries outside `[offsetMs, offsetMs + durationMs]` are dropped and the rest
 * shifted by `-offsetMs`. Other fields pass through untouched.
 */
export function shiftTelemetry(
  raw: unknown,
  offsetMs: number,
  durationMs: number,
): ShiftedTelemetry {
  if (!isPlainObject(raw) || !Array.isArray(raw.points)) {
    throw new FsIpcError("TRIM_FAILED", "The telemetry file is not valid", {});
  }
  const endMs = offsetMs + durationMs;
  const file: Record<string, unknown> = { ...raw };
  for (const series of TELEMETRY_SERIES) {
    const list = raw[series];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new FsIpcError("TRIM_FAILED", "The telemetry file is not valid", { series });
    }
    const kept: unknown[] = [];
    // Cursor position going into the cut: the last point before it, moved to t=0.
    let lead: unknown[] | null = null;
    let leadT = Number.NEGATIVE_INFINITY;
    let hasStart = false;
    for (const entry of list) {
      if (!Array.isArray(entry) || typeof entry[0] !== "number" || !Number.isFinite(entry[0])) {
        continue;
      }
      const t = entry[0];
      if (t < offsetMs) {
        if (series === "points" && t >= leadT) {
          lead = entry;
          leadT = t;
        }
        continue;
      }
      if (t > endMs) continue;
      if (t === offsetMs) hasStart = true;
      kept.push([Math.round((t - offsetMs) * 1000) / 1000, ...entry.slice(1)]);
    }
    // Without it the cursor would vanish until the first move after the cut.
    if (lead && !hasStart) kept.unshift([0, ...lead.slice(1)]);
    file[series] = kept;
  }
  const count = (k: string) => (Array.isArray(file[k]) ? (file[k] as unknown[]).length : 0);
  return {
    file,
    pointCount: count("points"),
    hasClicks: count("clicks") > 0,
    hasKeys: count("keys") > 0,
  };
}

/** `telemetry.json.gz` → `{ stem: "telemetry", ext: ".json.gz" }` (first dot). */
function splitAllExt(name: string): { stem: string; ext: string } {
  const i = name.indexOf(".", 1);
  return i <= 0 ? { stem: name, ext: "" } : { stem: name.slice(0, i), ext: name.slice(i) };
}

async function rewriteTelemetry(
  fs: FsLike,
  inputAbs: string,
  offsetMs: number,
  durationMs: number,
): Promise<CutResult & Omit<ShiftedTelemetry, "file">> {
  let outputAbs: string | null = null;
  try {
    const bytes = new Uint8Array(await fs.readFile(inputAbs));
    const zipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      zipped ? await gunzipAsync(bytes) : bytes,
    );
    const shifted = shiftTelemetry(JSON.parse(text), offsetMs, durationMs);
    const json = Buffer.from(JSON.stringify(shifted.file), "utf8");
    const folder = path.dirname(inputAbs);
    const { stem, ext } = splitAllExt(path.basename(inputAbs));
    const name = await uniqueName(`${stem}-trimmed${ext}`, (c) =>
      pathExists(fs, path.join(folder, c)),
    );
    outputAbs = path.join(folder, name);
    await atomicWriteFile(fs, outputAbs, zipped ? new Uint8Array(await gzipAsync(json)) : json);
    return {
      outputAbs,
      durationMs,
      pointCount: shifted.pointCount,
      hasClicks: shifted.hasClicks,
      hasKeys: shifted.hasKeys,
    };
  } catch (err) {
    if (outputAbs !== null) await fs.rm(outputAbs, { force: true }).catch(() => undefined);
    throw failed("Could not rewrite the telemetry", err, { track: "telemetry" });
  }
}

// ---- trim --------------------------------------------------------------------

interface LinkedInput {
  key: LinkedTrackKey;
  stored: string;
  abs: string;
  size: number;
}

/** Resolve and stat every linked track before anything is written. */
async function resolveLinkedInputs(
  fs: FsLike,
  dir: string,
  paths: Partial<Record<LinkedTrackKey, string>>,
): Promise<LinkedInput[]> {
  const out: LinkedInput[] = [];
  for (const [key, stored] of Object.entries(paths) as [LinkedTrackKey, string][]) {
    if (stored === "") {
      throw new FsIpcError("SOURCE_NOT_FOUND", `The ${key} track has no file`, { track: key });
    }
    if (path.isAbsolute(stored) || /^[a-zA-Z]:[\\/]/.test(stored)) {
      throw new FsIpcError("INVALID_PATH", "Only media inside the project can be trimmed", {
        track: key,
        path: stored,
      });
    }
    const abs = await resolveWithin(fs, dir, stored.split("/").join(path.sep));
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error("not a file");
      out.push({ key, stored, abs, size: st.size });
    } catch {
      throw new FsIpcError("SOURCE_NOT_FOUND", `The ${key} track is missing`, {
        track: key,
        path: stored,
      });
    }
  }
  return out;
}

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
  const linkedPaths = await readLinkedTrackPaths(fs, dir);
  const linkedKeys = Object.keys(linkedPaths) as LinkedTrackKey[];
  const trimLinked = req.trimLinkedTracks === true && linkedKeys.length > 0;
  if (linkedKeys.length > 0 && !req.trimLinkedTracks && !req.allowLinkedTracks) {
    throw new FsIpcError(
      "TRIM_LINKED_TRACKS",
      "This recording has audio, webcam or cursor tracks that trimming would put out of sync",
      { tracks: linkedKeys },
    );
  }
  const linkedInputs = trimLinked ? await resolveLinkedInputs(fs, dir, linkedPaths) : [];

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

  const offsetMs = estimateTrimOffsetMs(window, videoDurationMs);
  const keep: TimeRange = { startMs: offsetMs, endMs: offsetMs + videoDurationMs };

  // Every linked output is produced before any original moves; one failure undoes them all.
  const produced: string[] = [outputAbs];
  const linked: TrimmedLinkedTracks = {};
  const entries: LinkedManifestEntry[] = [];
  let savedBytes = Math.max(0, src.size - outputSize);
  try {
    for (const input of linkedInputs) {
      let cut: CutResult;
      if (input.key === "telemetry") {
        const t = await rewriteTelemetry(fs, input.abs, offsetMs, videoDurationMs);
        produced.push(t.outputAbs);
        linked.telemetry = {
          path: toPosix(path.relative(dir, t.outputAbs)),
          pointCount: t.pointCount,
          hasClicks: t.hasClicks,
          hasKeys: t.hasKeys,
        };
        cut = t;
      } else {
        cut = await cutLinkedMedia({ fs, ff }, input.key, input.abs, keep, token);
        produced.push(cut.outputAbs);
        linked[input.key] = {
          path: toPosix(path.relative(dir, cut.outputAbs)),
          durationMs: cut.durationMs,
        };
      }
      const trimmedPath = toPosix(path.relative(dir, cut.outputAbs));
      const size = (await fs.stat(cut.outputAbs).catch(() => null))?.size ?? input.size;
      savedBytes += Math.max(0, input.size - size);
      entries.push({
        key: input.key,
        originalPath: input.stored,
        trimmedPath,
        stashedName: `${input.key}-${path.basename(input.abs)}`,
      });
    }
  } catch (err) {
    for (const p of produced) await fs.rm(p, { force: true }).catch(() => undefined);
    throw failed("Could not trim the linked tracks", err);
  }

  const trimmedPath = toPosix(path.relative(dir, outputAbs));
  const trashDir = path.join(dir, TRIM_TRASH_DIR, token);
  const stashed: { from: string; to: string }[] = [];
  const stash = async (from: string, to: string) => {
    await fs.rename(from, to);
    stashed.push({ from, to });
  };
  try {
    await fs.mkdir(trashDir, { recursive: true });
    const manifest: TrimManifest = {
      version: 1,
      originalPath: src.stored,
      trimmedPath,
      createdAt: new Date(deps.now()).toISOString(),
      ...(entries.length > 0 ? { linked: entries } : {}),
    };
    await atomicWriteFile(fs, path.join(trashDir, TRIM_MANIFEST), JSON.stringify(manifest));
    await stash(src.abs, path.join(trashDir, path.basename(src.abs)));
    for (const [i, entry] of entries.entries()) {
      const input = linkedInputs[i];
      if (input) await stash(input.abs, path.join(trashDir, entry.stashedName));
    }
  } catch (err) {
    for (const s of stashed.reverse()) await fs.rename(s.to, s.from).catch(() => undefined);
    for (const p of produced) await fs.rm(p, { force: true }).catch(() => undefined);
    await fs.rm(trashDir, { recursive: true, force: true }).catch(() => undefined);
    throw failed("Could not move the original into the project trash", err);
  }
  deps.onTrashed?.(dir);

  return {
    clips: rewriteClips(req.clips ?? [], offsetMs),
    videoPath: trimmedPath,
    videoDurationMs,
    savedBytes,
    offsetMs,
    undoToken: token,
    ...(entries.length > 0 ? { linked } : {}),
  };
}

const LINKED_KEYS: ReadonlySet<string> = new Set(["mic", "system", "webcam", "telemetry"]);

function parseLinkedEntries(raw: unknown): LinkedManifestEntry[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: LinkedManifestEntry[] = [];
  for (const e of raw) {
    if (
      !isPlainObject(e) ||
      typeof e.key !== "string" ||
      !LINKED_KEYS.has(e.key) ||
      typeof e.originalPath !== "string" ||
      typeof e.trimmedPath !== "string" ||
      typeof e.stashedName !== "string" ||
      path.basename(e.stashedName) !== e.stashedName ||
      e.stashedName === TRIM_MANIFEST
    ) {
      return null;
    }
    out.push({
      key: e.key as LinkedTrackKey,
      originalPath: e.originalPath,
      trimmedPath: e.trimmedPath,
      stashedName: e.stashedName,
    });
  }
  return out;
}

async function readManifest(fs: FsLike, trashDir: string): Promise<TrimManifest> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(trashDir, TRIM_MANIFEST), "utf8"));
    const m = raw as Partial<TrimManifest>;
    const linked = parseLinkedEntries(m.linked);
    if (typeof m.originalPath === "string" && typeof m.trimmedPath === "string" && linked) {
      return {
        version: 1,
        originalPath: m.originalPath,
        trimmedPath: m.trimmedPath,
        createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
        linked,
      };
    }
  } catch {
    // fall through
  }
  throw new FsIpcError("TRIM_UNDO_NOT_FOUND", "The trimmed original is no longer available");
}

const fromPosix = (p: string): string => p.split("/").join(path.sep);

/** Move trimmed originals (video and any linked tracks) back and remove the trimmed copies. */
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
  const originalAbs = resolveWithinSync(dir, fromPosix(manifest.originalPath));
  const moves = [
    {
      stashed: path.join(trashDir, path.basename(originalAbs)),
      original: originalAbs,
      originalPath: manifest.originalPath,
      trimmed: resolveWithinSync(dir, fromPosix(manifest.trimmedPath)),
    },
    ...(manifest.linked ?? []).map((e) => ({
      stashed: path.join(trashDir, e.stashedName),
      original: resolveWithinSync(dir, fromPosix(e.originalPath)),
      originalPath: e.originalPath,
      trimmed: resolveWithinSync(dir, fromPosix(e.trimmedPath)),
    })),
  ];
  // Check everything first so a restore never lands half-applied on a predictable conflict.
  for (const m of moves) {
    if (!(await pathExists(fs, m.stashed))) {
      throw new FsIpcError("TRIM_UNDO_NOT_FOUND", "The trimmed original is no longer available");
    }
  }
  for (const m of moves) {
    if (await pathExists(fs, m.original)) {
      throw new FsIpcError("TRIM_FAILED", "A file already exists where the original was", {
        path: m.originalPath,
      });
    }
  }
  const restored: typeof moves = [];
  try {
    for (const m of moves) {
      await fs.mkdir(path.dirname(m.original), { recursive: true });
      await fs.rename(m.stashed, m.original);
      restored.push(m);
    }
  } catch (err) {
    // Put back what already moved so the trimmed state (and this token) stays usable.
    for (const m of restored.reverse()) {
      await fs.rename(m.original, m.stashed).catch(() => undefined);
    }
    throw failed("Could not restore the original", err);
  }
  for (const m of moves) await fs.rm(m.trimmed, { force: true }).catch(() => undefined);
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
