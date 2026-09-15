import { type VideoEncodeSettings, videoEncoderArgs } from "./encoders";
import { MediaError } from "./errors";

/**
 * Pure ffmpeg argument builders (ENGINEERING_SPEC §0 fallbacks, §9.6, §9.9).
 * Every long-running job reports through `-progress pipe:1`; quick jobs that
 * return data on stdout (thumbnail) do not.
 */

export interface TimeRange {
  startMs: number;
  endMs: number;
}

/** Shared prefix: overwrite, quiet banner, machine progress on stdout. */
export const PROGRESS_PREFIX = [
  "-hide_banner",
  "-nostdin",
  "-y",
  "-progress",
  "pipe:1",
  "-nostats",
];

/** ms → ffmpeg seconds string, rounded to whole ms (`1234.4` → `"1.234"`); negatives clamp to 0. */
export function sec(ms: number): string {
  const s = Math.round(Math.max(0, ms)) / 1000;
  return String(Number(s.toFixed(3)));
}

function assertRange(r: TimeRange, label: string): void {
  if (
    !Number.isFinite(r.startMs) ||
    !Number.isFinite(r.endMs) ||
    r.startMs < 0 ||
    r.endMs <= r.startMs
  ) {
    throw new MediaError("MEDIA_INVALID_ARGS", `${label}: invalid range ${r.startMs}–${r.endMs}`);
  }
}

// ---- remux / transcode ---------------------------------------------------

/** Container change only (e.g. MediaRecorder WebM → MP4) with `-c copy`. */
export function buildRemuxToMp4Args(input: string, output: string): string[] {
  return [
    ...PROGRESS_PREFIX,
    "-i",
    input,
    "-map",
    "0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    output,
  ];
}

export interface TranscodeOptions extends Omit<VideoEncodeSettings, "fps"> {
  input: string;
  output: string;
  /** Source/output fps — sizes the 2s GOP; the frame rate itself is left untouched. */
  fps: number;
  audioBitrateKbps?: number | undefined;
}

/** VP9 (or anything) → H.264/AAC MP4. Progress ratio uses the probed duration. */
export function buildTranscodeToH264Args(o: TranscodeOptions): string[] {
  return [
    ...PROGRESS_PREFIX,
    "-i",
    o.input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...videoEncoderArgs(o),
    "-c:a",
    "aac",
    "-b:a",
    `${o.audioBitrateKbps ?? 192}k`,
    "-movflags",
    "+faststart",
    o.output,
  ];
}

// ---- captions audio (§9.6) -----------------------------------------------

export interface AudioRange extends TimeRange {
  /** Playback rate of this timeline range (speed region); default 1. */
  rate?: number | undefined;
}

/** `atempo` accepts 0.5–2 in older ffmpeg builds: chain factors to reach any rate. */
export function atempoChain(rate: number): string[] {
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new MediaError("MEDIA_INVALID_ARGS", `invalid playback rate ${rate}`);
  }
  if (Math.abs(rate - 1) < 1e-9) return [];
  const out: string[] = [];
  let r = rate;
  while (r > 2) {
    out.push("atempo=2");
    r /= 2;
  }
  while (r < 0.5) {
    out.push("atempo=0.5");
    r /= 0.5;
  }
  if (Math.abs(r - 1) > 1e-9) out.push(`atempo=${Number(r.toFixed(6))}`);
  return out;
}

export interface ExtractWavOptions {
  input: string;
  output: string;
  /** Source ranges in timeline order (after trims/speeds, so timestamps match). */
  ranges: readonly AudioRange[];
  /** Audio stream index within the input; default first. */
  audioStream?: number | undefined;
}

/** Filter graph: atrim each range, re-zero, apply speed, concat → 16 kHz mono. */
export function buildWavFilterGraph(ranges: readonly AudioRange[], audioStream = 0): string {
  if (ranges.length === 0) throw new MediaError("MEDIA_INVALID_ARGS", "no audio ranges");
  const parts: string[] = [];
  ranges.forEach((r, i) => {
    assertRange(r, `range ${i}`);
    const chain = [
      `atrim=start=${sec(r.startMs)}:end=${sec(r.endMs)}`,
      "asetpts=PTS-STARTPTS",
      ...atempoChain(r.rate ?? 1),
    ];
    parts.push(`[0:a:${audioStream}]${chain.join(",")}[a${i}]`);
  });
  const labels = ranges.map((_, i) => `[a${i}]`).join("");
  const tail = "aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono";
  parts.push(
    ranges.length === 1
      ? `[a0]${tail}[out]`
      : `${labels}concat=n=${ranges.length}:v=0:a=1,${tail}[out]`,
  );
  return parts.join(";");
}

export function buildExtractWavArgs(o: ExtractWavOptions): string[] {
  return [
    ...PROGRESS_PREFIX,
    "-i",
    o.input,
    "-filter_complex",
    buildWavFilterGraph(o.ranges, o.audioStream ?? 0),
    "-map",
    "[out]",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    o.output,
  ];
}

/** Timeline-length of the extracted WAV (for progress ratio), ms. */
export function extractedDurationMs(ranges: readonly AudioRange[]): number {
  return ranges.reduce((acc, r) => acc + Math.max(0, r.endMs - r.startMs) / (r.rate ?? 1), 0);
}

// ---- trim source to used range (§9.9) ------------------------------------

export const TRIM_HANDLE_MS = 1000;

/** Hull of all clip source ranges; null for no clips. */
export function usedSourceRange(
  clips: readonly { sourceStartMs: number; sourceEndMs: number }[],
): TimeRange | null {
  if (clips.length === 0) return null;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const c of clips) {
    startMs = Math.min(startMs, c.sourceStartMs);
    endMs = Math.max(endMs, c.sourceEndMs);
  }
  return { startMs, endMs };
}

/** Used range widened by 1s handles and clamped to the source. */
export function trimWindow(
  used: TimeRange,
  sourceDurationMs: number,
  handleMs = TRIM_HANDLE_MS,
): TimeRange {
  assertRange(used, "used range");
  const startMs = Math.max(0, used.startMs - handleMs);
  const endMs = Math.min(Math.max(sourceDurationMs, 0), used.endMs + handleMs);
  if (endMs <= startMs) throw new MediaError("MEDIA_INVALID_ARGS", "used range outside source");
  return { startMs, endMs };
}

export interface TrimSourceOptions {
  input: string;
  output: string;
  used: TimeRange;
  sourceDurationMs: number;
  handleMs?: number | undefined;
}

/**
 * `-c copy` cut. Input seeking snaps to the preceding keyframe, which is why the
 * spec keeps 1s handles; callers re-probe the output and offset clips by
 * `window.startMs`.
 */
export function buildTrimSourceArgs(o: TrimSourceOptions): { args: string[]; window: TimeRange } {
  const window = trimWindow(o.used, o.sourceDurationMs, o.handleMs ?? TRIM_HANDLE_MS);
  const args = [
    ...PROGRESS_PREFIX,
    "-ss",
    sec(window.startMs),
    "-i",
    o.input,
    "-t",
    sec(window.endMs - window.startMs),
    "-map",
    "0",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    o.output,
  ];
  return { args, window };
}

// ---- thumbnail -----------------------------------------------------------

export interface ThumbnailOptions {
  input: string;
  atMs: number;
  /** Output width (height keeps aspect, even). Omitted = source size. */
  width?: number | undefined;
  format?: "png" | "jpg" | undefined;
}

/** Single frame to stdout (`image2pipe`). */
export function buildThumbnailArgs(o: ThumbnailOptions): string[] {
  const format = o.format ?? "png";
  const filters =
    o.width !== undefined ? ["-vf", `scale=${Math.max(2, Math.round(o.width / 2) * 2)}:-2`] : [];
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-ss",
    sec(o.atMs),
    "-i",
    o.input,
    "-frames:v",
    "1",
    "-an",
    ...filters,
    "-f",
    "image2pipe",
    "-c:v",
    format === "png" ? "png" : "mjpeg",
    "pipe:1",
  ];
}

/** Alias used by the project domain (§9.9 "trim source to used range"). */
export const trimCopyArgs = buildTrimSourceArgs;

// ---- PCM WAV fallback → AAC/Opus mux (§10.1, §10.5) ------------------------

export interface MuxAudioOptions {
  video: string;
  wav: string;
  output: string;
  container: "mp4" | "webm";
  audioBitrateKbps?: number | undefined;
}

/** Copy the video stream, encode the WAV as AAC (mp4) or Opus (webm), 48 kHz. */
export function muxAudioArgs(o: MuxAudioOptions): string[] {
  const bitrate = `${o.audioBitrateKbps ?? 192}k`;
  const audio =
    o.container === "mp4"
      ? ["-c:a", "aac", "-b:a", bitrate, "-ar", "48000", "-movflags", "+faststart"]
      : ["-c:a", "libopus", "-b:a", bitrate, "-ar", "48000"];
  return [
    ...PROGRESS_PREFIX,
    "-i",
    o.video,
    "-i",
    o.wav,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    ...audio,
    "-f",
    o.container,
    o.output,
  ];
}

// ---- preview proxy (§6.3) --------------------------------------------------

export const PROXY_HEIGHT = 1080;

/** 1080p H.264 preview proxy, video only. */
export function proxyArgs(o: { input: string; output: string }): string[] {
  return [
    ...PROGRESS_PREFIX,
    "-i",
    o.input,
    "-map",
    "0:v:0",
    "-vf",
    `scale=-2:${PROXY_HEIGHT}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    o.output,
  ];
}

// ---- filmstrip (§6.7) ------------------------------------------------------

export interface FilmstripOptions {
  input: string;
  /** Directory the numbered JPEGs are written into. */
  outputDir: string;
  intervalMs: number;
  height: number;
  /** Path joiner for the output pattern (inject `path.win32.join` in tests). */
  join?: ((...parts: string[]) => string) | undefined;
}

export const FILMSTRIP_PATTERN = "%06d.jpg";

/** One JPEG every `intervalMs` of source, `height` px tall, numbered from 1. */
export function filmstripArgs(o: FilmstripOptions): string[] {
  if (!(o.intervalMs > 0) || !Number.isFinite(o.intervalMs)) {
    throw new MediaError("MEDIA_INVALID_ARGS", `invalid filmstrip interval ${o.intervalMs}`);
  }
  if (!(o.height >= 2) || !Number.isFinite(o.height)) {
    throw new MediaError("MEDIA_INVALID_ARGS", `invalid filmstrip height ${o.height}`);
  }
  const height = Math.max(2, Math.round(o.height / 2) * 2);
  const join = o.join ?? ((...parts: string[]) => parts.join("/"));
  return [
    ...PROGRESS_PREFIX,
    "-i",
    o.input,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `fps=1/${sec(o.intervalMs)},scale=-2:${height}`,
    "-q:v",
    "5",
    "-start_number",
    "1",
    "-f",
    "image2",
    join(o.outputDir, FILMSTRIP_PATTERN),
  ];
}

/** Single JPEG frame written to `output` (e.g. a project `thumbnail.jpg`). */
export function thumbnailArgs(o: {
  input: string;
  output: string;
  atMs: number;
  width?: number | undefined;
}): string[] {
  const filters =
    o.width !== undefined ? ["-vf", `scale=${Math.max(2, Math.round(o.width / 2) * 2)}:-2`] : [];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-ss",
    sec(o.atMs),
    "-i",
    o.input,
    "-frames:v",
    "1",
    "-an",
    ...filters,
    "-q:v",
    "3",
    "-f",
    "image2",
    o.output,
  ];
}
