import type { Platform } from "./ffmpegPaths";

/**
 * H.264 encoder selection for ffmpeg routes (ENGINEERING_SPEC §10.1 route 2):
 * `h264_videotoolbox` on macOS, `h264_nvenc` / `h264_qsv` / `h264_amf` on
 * Windows, `h264_nvenc` / `h264_qsv` on Linux, `libx264` as the software floor.
 */

export const SOFTWARE_H264 = "libx264";

export type H264Encoder =
  | "h264_videotoolbox"
  | "h264_nvenc"
  | "h264_qsv"
  | "h264_amf"
  | typeof SOFTWARE_H264;

export function hardwareH264Candidates(platform: Platform): H264Encoder[] {
  switch (platform) {
    case "darwin":
      return ["h264_videotoolbox"];
    case "win32":
      return ["h264_nvenc", "h264_qsv", "h264_amf"];
    case "linux":
      return ["h264_nvenc", "h264_qsv"];
    default:
      return [];
  }
}

/** `ffmpeg -hide_banner -encoders` — list compiled-in encoders. */
export function buildListEncodersArgs(): string[] {
  return ["-hide_banner", "-encoders"];
}

/** Encoder names from `-encoders` output (lines like ` V....D h264_nvenc  NVIDIA …`). */
export function parseEncoderList(text: string): Set<string> {
  const out = new Set<string>();
  let started = false;
  for (const line of text.split(/\r?\n/)) {
    if (!started) {
      if (/^\s*-{2,}\s*$/.test(line)) started = true;
      continue;
    }
    const m = /^\s*[VASFXBD.]{6}\s+(\S+)/.exec(line);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

/**
 * First compiled-in hardware encoder for the platform, else libx264. Encoders
 * the caller already saw fail (`rejected`) are skipped so a retry falls back.
 */
export function selectH264Encoder(
  platform: Platform,
  available: ReadonlySet<string>,
  opts: { preferSoftware?: boolean | undefined; rejected?: ReadonlySet<string> | undefined } = {},
): H264Encoder {
  if (opts.preferSoftware) return SOFTWARE_H264;
  const hw = hardwareH264Candidates(platform).find(
    (e) => available.has(e) && !opts.rejected?.has(e),
  );
  return hw ?? SOFTWARE_H264;
}

export interface VideoEncodeSettings {
  encoder: H264Encoder;
  fps: number;
  /** Target bitrate; libx264 uses CRF instead when omitted. */
  bitrateKbps?: number | undefined;
  /** Keyframe interval (§10.3: every 2s). */
  keyframeSec?: number | undefined;
}

/** `-c:v …` and rate-control args, bt709 tagged (§10.4). */
export function videoEncoderArgs(s: VideoEncodeSettings): string[] {
  const gop = String(Math.max(1, Math.round(s.fps * (s.keyframeSec ?? 2))));
  const args = ["-c:v", s.encoder];
  const kbps = s.bitrateKbps !== undefined ? Math.max(1, Math.round(s.bitrateKbps)) : undefined;
  const rate =
    kbps !== undefined
      ? ["-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`]
      : [];

  switch (s.encoder) {
    case "libx264":
      args.push("-preset", "veryfast");
      if (kbps === undefined) args.push("-crf", "18");
      else args.push(...rate);
      break;
    case "h264_videotoolbox":
      args.push("-allow_sw", "1", ...(kbps !== undefined ? rate : ["-q:v", "65"]));
      break;
    case "h264_nvenc":
      args.push("-preset", "p5", "-rc", "vbr", ...(kbps !== undefined ? rate : ["-cq", "19"]));
      break;
    case "h264_qsv":
      args.push(...(kbps !== undefined ? rate : ["-global_quality", "20"]));
      break;
    case "h264_amf":
      args.push(
        ...(kbps !== undefined
          ? ["-rc", "vbr_peak", ...rate]
          : ["-rc", "cqp", "-qp_i", "18", "-qp_p", "20"]),
      );
      break;
  }
  args.push(
    "-g",
    gop,
    "-pix_fmt",
    "yuv420p",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
  );
  return args;
}
