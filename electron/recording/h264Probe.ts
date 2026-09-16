import { PROGRESS_PREFIX, buildTranscodeToH264Args } from "../media/args";
import {
  type H264Encoder,
  SOFTWARE_H264,
  buildListEncodersArgs,
  parseEncoderList,
  videoEncoderArgs,
} from "../media/encoders";
import type { FfmpegPaths, Platform } from "../media/ffmpegPaths";
import { type RunnerDeps, runFfmpeg } from "../media/runner";

/**
 * Hardware H.264 encoder for the background recording transcode (SPEC §5.2):
 * `h264_videotoolbox` on macOS, `h264_nvenc` / `h264_qsv` / `h264_amf` on
 * Windows, `h264_nvenc` / `h264_vaapi` on Linux, `libx264` otherwise.
 *
 * A candidate is used only when `ffmpeg -encoders` lists it AND a tiny test
 * encode with the exact video arguments the transcode uses succeeds (a listed
 * encoder often has no device/driver behind it). Results are cached for the app
 * session; an encoder that later fails a real transcode is rejected, so the
 * next selection falls through to the next candidate or libx264.
 */

export type TranscodeEncoder = H264Encoder | "h264_vaapi";

/** Default DRM render node for VAAPI. */
export const VAAPI_DEVICE = "/dev/dri/renderD128";
/** A hung driver must not block the transcode queue forever. */
export const ENCODER_TEST_TIMEOUT_MS = 15_000;

export function transcodeH264Candidates(platform: Platform): TranscodeEncoder[] {
  switch (platform) {
    case "darwin":
      return ["h264_videotoolbox"];
    case "win32":
      return ["h264_nvenc", "h264_qsv", "h264_amf"];
    case "linux":
      return ["h264_nvenc", "h264_vaapi"];
    default:
      return [];
  }
}

/** Frames are uploaded to the VAAPI surface; constant QP, bt709 tagged like the other routes. */
function vaapiVideoArgs(fps: number): string[] {
  const gop = String(Math.max(1, Math.round(fps * 2)));
  return [
    "-vf",
    "format=nv12,hwupload",
    "-c:v",
    "h264_vaapi",
    "-qp",
    "20",
    "-g",
    gop,
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
  ];
}

const transcodeVideoArgs = (encoder: TranscodeEncoder, fps: number): string[] =>
  encoder === "h264_vaapi" ? vaapiVideoArgs(fps) : videoEncoderArgs({ encoder, fps });

/** Device setup that must precede `-i`. */
const deviceArgs = (encoder: TranscodeEncoder): string[] =>
  encoder === "h264_vaapi" ? ["-vaapi_device", VAAPI_DEVICE] : [];

export interface RecordingTranscodeArgs {
  input: string;
  output: string;
  encoder: TranscodeEncoder;
  fps: number;
}

/** Full VP9→H.264 transcode command for any encoder (audio → AAC, +faststart). */
export function buildRecordingTranscodeArgs(o: RecordingTranscodeArgs): string[] {
  if (o.encoder !== "h264_vaapi") {
    return buildTranscodeToH264Args({
      input: o.input,
      output: o.output,
      fps: o.fps,
      encoder: o.encoder,
    });
  }
  return [
    ...PROGRESS_PREFIX,
    ...deviceArgs(o.encoder),
    "-i",
    o.input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...vaapiVideoArgs(o.fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    o.output,
  ];
}

/** Encode a few synthetic frames with the transcode's video args, discarding the output. */
export function buildEncoderTestArgs(encoder: TranscodeEncoder): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    ...deviceArgs(encoder),
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x240:r=30",
    "-frames:v",
    "3",
    "-an",
    ...transcodeVideoArgs(encoder, 30),
    "-f",
    "null",
    "-",
  ];
}

export interface H264EncoderSource {
  /** Best working encoder right now; never rejects (falls back to libx264). */
  select(): Promise<TranscodeEncoder>;
  /** A real transcode failed with `encoder`: stop selecting it. */
  reject(encoder: TranscodeEncoder): void;
}

/** Always libx264 (tests, or when hardware is disabled). */
export const softwareH264Source: H264EncoderSource = {
  select: async () => SOFTWARE_H264,
  reject: () => {},
};

export interface H264EncoderProbeDeps {
  runner: RunnerDeps;
  resolveBinaries(): FfmpegPaths | null;
  platform: Platform;
  timeoutMs?: number | undefined;
  log?: ((message: string) => void) | undefined;
}

export function createH264EncoderProbe(deps: H264EncoderProbeDeps): H264EncoderSource {
  const log = deps.log ?? (() => {});
  const timeoutMs = deps.timeoutMs ?? ENCODER_TEST_TIMEOUT_MS;
  const rejected = new Set<TranscodeEncoder>();
  const works = new Map<TranscodeEncoder, Promise<boolean>>();
  let listed: Promise<ReadonlySet<string>> | null = null;

  const run = async (ffmpeg: string, args: string[], collectStdout: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await runFfmpeg(deps.runner, {
        bin: ffmpeg,
        args,
        signal: controller.signal,
        collectStdout,
        maxStdoutBytes: 1024 * 1024,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const list = (ffmpeg: string): Promise<ReadonlySet<string>> => {
    listed ??= run(ffmpeg, buildListEncodersArgs(), true).then(
      (res) => parseEncoderList(new TextDecoder().decode(res.stdout)),
      (err: unknown) => {
        log(`ffmpeg -encoders failed; using ${SOFTWARE_H264}: ${String(err)}`);
        return new Set<string>();
      },
    );
    return listed;
  };

  const test = (ffmpeg: string, encoder: TranscodeEncoder): Promise<boolean> => {
    let result = works.get(encoder);
    if (!result) {
      result = run(ffmpeg, buildEncoderTestArgs(encoder), false).then(
        () => true,
        (err: unknown) => {
          log(`${encoder} test encode failed: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        },
      );
      works.set(encoder, result);
    }
    return result;
  };

  return {
    select: async () => {
      const bins = deps.resolveBinaries();
      if (!bins) return SOFTWARE_H264;
      const candidates = transcodeH264Candidates(deps.platform).filter((e) => !rejected.has(e));
      if (candidates.length === 0) return SOFTWARE_H264;
      const available = await list(bins.ffmpeg);
      for (const encoder of candidates) {
        if (
          available.has(encoder) &&
          !rejected.has(encoder) &&
          (await test(bins.ffmpeg, encoder))
        ) {
          return encoder;
        }
      }
      return SOFTWARE_H264;
    },
    reject: (encoder) => {
      if (encoder !== SOFTWARE_H264) rejected.add(encoder);
    },
  };
}
