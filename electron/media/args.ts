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
