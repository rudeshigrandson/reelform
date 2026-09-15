import { type Codec, exportBitrate } from "../bitrate";
import type { ExportConfig } from "../route";

/**
 * VideoEncoder configuration (ENGINEERING_SPEC §10.1 route 1/3, §10.3, §10.4).
 *
 * Codec strings carry the lowest profile level that fits the output size and
 * frame rate, so hardware encoders are not asked for more than they need.
 */

export type Container = ExportConfig["container"];
export type HardwarePreference = "prefer-hardware" | "prefer-software";

/** §10.4 — Rec.709 primaries/transfer/matrix, limited range. */
export const BT709_LIMITED: VideoColorSpaceInit = {
  primaries: "bt709",
  transfer: "bt709",
  matrix: "bt709",
  fullRange: false,
};

/** `VideoEncoderConfig` plus the colour space the muxer writes into `colr`. */
export interface ExportVideoEncoderConfig extends VideoEncoderConfig {
  codec: string;
  hardwareAcceleration: HardwarePreference;
  colorSpace: VideoColorSpaceInit;
}

/**
 * [level id, max picture size (px or macroblocks), max sample rate per second,
 * max bitrate (bits/s)]. A level whose max bitrate is below the target makes
 * hardware encoders reject the config or clamp quality, so bitrate is a
 * selection criterion too.
 */
type LevelRow = readonly [id: number, maxSize: number, maxRate: number, maxBitrate?: number];

/** H.264 High profile: MaxBR × cpbBrVclFactor 1250 (Table A-1 / A-2). */
const H264_HIGH = (kbps: number): number => kbps * 1250;
// H.264 Table A-1: MaxFS (macroblocks), MaxMBPS, MaxBR.
const H264_LEVELS: readonly LevelRow[] = [
  [30, 1620, 40500, H264_HIGH(10_000)],
  [31, 3600, 108000, H264_HIGH(14_000)],
  [32, 5120, 216000, H264_HIGH(20_000)],
  [40, 8192, 245000, H264_HIGH(20_000)],
  [41, 8192, 245000, H264_HIGH(50_000)],
  [42, 8704, 522240, H264_HIGH(50_000)],
  [50, 22080, 589824, H264_HIGH(135_000)],
  [51, 36864, 983040, H264_HIGH(240_000)],
  [52, 36864, 2073600, H264_HIGH(240_000)],
  [60, 139264, 4177920, H264_HIGH(240_000)],
  [61, 139264, 8355840, H264_HIGH(480_000)],
  [62, 139264, 16711680, H264_HIGH(800_000)],
];
// HEVC Table A.8: general_level_idc (= level × 30), MaxLumaPs, MaxLumaSr, Main-tier MaxBR (Main profile).
const HEVC_LEVELS: readonly LevelRow[] = [
  [93, 983040, 33177600, 10_000_000],
  [120, 2228224, 66846720, 12_000_000],
  [123, 2228224, 133693440, 20_000_000],
  [150, 8912896, 267386880, 25_000_000],
  [153, 8912896, 534773760, 40_000_000],
  [156, 8912896, 1069547520, 60_000_000],
  [180, 35651584, 1069547520, 60_000_000],
  [183, 35651584, 2139095040, 120_000_000],
  [186, 35651584, 4278190080, 240_000_000],
];
// AV1 Annex A: seq_level_idx, MaxPicSize, MaxDisplayRate, Main-tier MaxBitrate (profile 0).
const AV1_LEVELS: readonly LevelRow[] = [
  [4, 665856, 24969600, 6_000_000],
  [5, 1065024, 39938400, 10_000_000],
  [8, 2359296, 77856768, 12_000_000],
  [9, 2359296, 155713536, 20_000_000],
  [12, 8912896, 273705984, 30_000_000],
  [13, 8912896, 547411968, 40_000_000],
  [14, 8912896, 1094860800, 60_000_000],
  [15, 8912896, 1176502272, 60_000_000],
  [16, 35651584, 1176502272, 60_000_000],
  [17, 35651584, 2189721600, 100_000_000],
  [18, 35651584, 4379443200, 160_000_000],
  [19, 35651584, 4706009088, 160_000_000],
];
// VP9 levels: level × 10, MaxPictureSize, MaxLumaSampleRate, MaxBitrate.
const VP9_LEVELS: readonly LevelRow[] = [
  [30, 552960, 20736000, 7_200_000],
  [31, 983040, 36864000, 12_000_000],
  [40, 2228224, 83558400, 18_000_000],
  [41, 2228224, 160432128, 30_000_000],
  [50, 8912896, 311951360, 60_000_000],
  [51, 8912896, 588251136, 120_000_000],
  [52, 8912896, 1176502272, 180_000_000],
  [60, 35651584, 1176502272, 180_000_000],
  [61, 35651584, 2353004544, 240_000_000],
  [62, 35651584, 4706009088, 480_000_000],
];

/** First level whose limits fit; the highest level when nothing fits. */
export function pickLevel(
  table: readonly LevelRow[],
  size: number,
  rate: number,
  bitrate = 0,
): number {
  for (const [id, maxSize, maxRate, maxBitrate] of table) {
    if (size <= maxSize && rate <= maxRate && bitrate <= (maxBitrate ?? Number.POSITIVE_INFINITY))
      return id;
  }
  return (table[table.length - 1] as LevelRow)[0];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/**
 * WebCodecs codec string for the output size / rate / target bitrate (bits/s;
 * 0 ignores the bitrate limit). H.264 is High profile; HEVC/AV1 Main tier.
 */
export function codecString(
  codec: Codec,
  width: number,
  height: number,
  fps: number,
  bitrate = 0,
): string {
  const pixels = width * height;
  const rate = pixels * fps;
  switch (codec) {
    case "h264": {
      const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
      return `avc1.6400${hex2(pickLevel(H264_LEVELS, mbs, mbs * fps, bitrate))}`;
    }
    case "hevc":
      return `hvc1.1.6.L${pickLevel(HEVC_LEVELS, pixels, rate, bitrate)}.B0`;
    case "av1":
      return `av01.0.${String(pickLevel(AV1_LEVELS, pixels, rate, bitrate)).padStart(2, "0")}M.08`;
    case "vp9":
      return `vp09.00.${pickLevel(VP9_LEVELS, pixels, rate, bitrate)}.08`;
  }
}

/** mediabunny's codec id for an export codec. */
export function muxerVideoCodec(codec: Codec): "avc" | "hevc" | "av1" | "vp9" {
  return codec === "h264" ? "avc" : codec;
}

/** Which video codecs each container can carry. */
export function containerSupports(container: Container, codec: Codec): boolean {
  return container === "mp4" ? true : codec === "vp9" || codec === "av1";
}

export function buildVideoEncoderConfig(
  config: ExportConfig,
  hardwareAcceleration: HardwarePreference,
): ExportVideoEncoderConfig {
  const { codec, width, height, fps, quality } = config;
  const bitrate = exportBitrate(width, height, fps, codec, quality);
  const out: ExportVideoEncoderConfig = {
    codec: codecString(codec, width, height, fps, bitrate),
    width,
    height,
    framerate: fps,
    bitrate,
    bitrateMode: "variable",
    latencyMode: "quality",
    hardwareAcceleration,
    colorSpace: { ...BT709_LIMITED },
  };
  // MP4 needs length-prefixed NAL units with out-of-band parameter sets.
  if (codec === "h264") out.avc = { format: "avc" };
  return out;
}

/** Why the output config cannot be encoded at all (never retried). */
export class ExportConfigError extends Error {
  override name = "ExportConfigError";
}

/** Neither hardware nor software encoder accepts the config. */
export class EncoderUnsupportedError extends Error {
  override name = "EncoderUnsupportedError";
}

/** Static validation that holds regardless of the machine. */
export function validateExportConfig(config: ExportConfig): void {
  const { width, height, fps, codec, container } = config;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ExportConfigError(`invalid output size ${width}×${height}`);
  }
  // Every export codec here encodes 4:2:0, which needs even dimensions.
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new ExportConfigError(`output size ${width}×${height} must be even`);
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new ExportConfigError(`invalid fps ${fps}`);
  if (!containerSupports(container, codec)) {
    throw new ExportConfigError(`${container} cannot carry ${codec}`);
  }
}

export interface VideoEncoderProbe {
  isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
}

/**
 * Probe the encoder: hardware first when requested, then software (§10.1
 * route 3). Throws `EncoderUnsupportedError` when neither is accepted.
 */
export async function resolveVideoEncoderConfig(
  config: ExportConfig,
  probe: VideoEncoderProbe,
  preferHardware: boolean,
): Promise<ExportVideoEncoderConfig> {
  const order: HardwarePreference[] = preferHardware
    ? ["prefer-hardware", "prefer-software"]
    : ["prefer-software"];
  for (const pref of order) {
    const candidate = buildVideoEncoderConfig(config, pref);
    let supported = false;
    try {
      supported = (await probe.isConfigSupported(candidate)).supported === true;
    } catch {
      supported = false;
    }
    if (supported) return candidate;
  }
  throw new EncoderUnsupportedError(
    `no encoder accepts ${config.codec} ${config.width}×${config.height}`,
  );
}
