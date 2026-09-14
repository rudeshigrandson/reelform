import { buildExtractWavArgs } from "../media/args";
import type { FfmpegPaths } from "../media/ffmpegPaths";
import { type RunnerDeps, runFfmpeg } from "../media/runner";
import type { SilenceSplitter, WavExtractor } from "./transcribe";

/**
 * ffmpeg-backed ports for the captions pipeline (SPEC §9.6): timeline-range WAV
 * extraction and silence splitting. Pure with respect to injected runner deps.
 */

export interface CaptionsFfmpegDeps {
  runner: RunnerDeps;
  resolveBinaries(): FfmpegPaths | null;
}

/** Captions-domain error; `code` crosses IPC through toIpcError. */
export class CaptionsFfmpegError extends Error {
  readonly code = "FFMPEG_NOT_FOUND";
  constructor() {
    super("ffmpeg is not available; install or bundle it to generate captions");
    this.name = "CaptionsFfmpegError";
  }
}

function ffmpegBin(deps: CaptionsFfmpegDeps): string {
  const b = deps.resolveBinaries();
  if (!b) throw new CaptionsFfmpegError();
  return b.ffmpeg;
}

export interface Span {
  startMs: number;
  endMs: number;
}

/** Parse `silencedetect` stderr into silent spans (ms). Unterminated trailing silence runs to `durationMs`. */
export function parseSilenceDetect(lines: readonly string[], durationMs: number): Span[] {
  const spans: Span[] = [];
  let open: number | null = null;
  for (const line of lines) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start?.[1] !== undefined) {
      open = Math.max(0, Number(start[1]) * 1000);
      continue;
    }
    const end = /silence_end:\s*([\d.]+)/.exec(line);
    if (end?.[1] !== undefined && open !== null) {
      const endMs = Number(end[1]) * 1000;
      if (endMs > open) spans.push({ startMs: open, endMs });
      open = null;
    }
  }
  if (open !== null && Number.isFinite(durationMs) && durationMs > open) {
    spans.push({ startMs: open, endMs: durationMs });
  }
  return spans;
}

/** Input duration from ffmpeg's `Duration: HH:MM:SS.ss` stderr line, ms; null when absent. */
export function parseDurationLine(lines: readonly string[]): number | null {
  for (const line of lines) {
    const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    }
  }
  return null;
}

/** Output length of a set of timeline ranges after speed regions, ms. */
export function rangesOutputMs(ranges: ReadonlyArray<Span & { rate?: number | undefined }>): number {
  return ranges.reduce((sum, r) => {
    const rate = r.rate !== undefined && r.rate > 0 ? r.rate : 1;
    return sum + Math.max(0, r.endMs - r.startMs) / rate;
  }, 0);
}

export function createFfmpegWavExtractor(deps: CaptionsFfmpegDeps): WavExtractor {
  return async ({ input, output, ranges, signal, onProgress }) => {
    const totalDurationMs = rangesOutputMs(ranges);
    await runFfmpeg(deps.runner, {
      bin: ffmpegBin(deps),
      args: buildExtractWavArgs({ input, output, ranges }),
      signal,
      totalDurationMs,
      onProgress: onProgress
        ? (p) => {
            if (p.outTimeMs !== null && totalDurationMs > 0) {
              onProgress(Math.min(1, Math.max(0, p.outTimeMs / totalDurationMs)));
            }
          }
        : undefined,
    });
    return { durationMs: totalDurationMs };
  };
}

/** Silence threshold and minimum length used to find chunk cut points. */
export const SILENCE_NOISE_DB = -35;
export const SILENCE_MIN_S = 0.5;
/** silencedetect prints two lines per gap; keep all of them for long recordings. */
const SILENCE_STDERR_LINES = 200_000;

export function createFfmpegSilenceSplitter(deps: CaptionsFfmpegDeps): SilenceSplitter {
  return {
    async detectSilences({ wavPath, signal }) {
      const res = await runFfmpeg(deps.runner, {
        bin: ffmpegBin(deps),
        args: [
          "-hide_banner",
          "-nostats",
          "-i",
          wavPath,
          "-af",
          `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_S}`,
          "-f",
          "null",
          "-",
        ],
        signal,
        stderrLines: SILENCE_STDERR_LINES,
      });
      const durationMs = parseDurationLine(res.stderrTail) ?? Number.POSITIVE_INFINITY;
      return parseSilenceDetect(res.stderrTail, durationMs);
    },
    async cut({ input, output, startMs, endMs, signal }) {
      await runFfmpeg(deps.runner, {
        bin: ffmpegBin(deps),
        args: [
          "-hide_banner",
          "-y",
          "-i",
          input,
          "-ss",
          (startMs / 1000).toFixed(3),
          "-to",
          (endMs / 1000).toFixed(3),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          output,
        ],
        signal,
      });
    },
  };
}
