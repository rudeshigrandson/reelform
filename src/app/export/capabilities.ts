import type { Codec } from "../../export/bitrate";
import {
  type HardwarePreference,
  type VideoEncoderProbe,
  buildVideoEncoderConfig,
} from "../../export/engine/encoderConfig";
import type { EncoderCaps } from "../../export/route";
import { t } from "../../i18n/format";

/**
 * Renderer-side encoder capability probing (§10.1, guide S22 "Not supported on
 * this device"): `VideoEncoder.isConfigSupported` for each codec with
 * hardware and software preference at a representative 1080p60 config. Probed
 * once per session; a failed probe is not cached.
 */

export interface CodecSupport {
  hardware: boolean;
  software: boolean;
}

export type EncoderCapabilities = Record<Codec, CodecSupport>;

export const PROBE_CODECS: readonly Codec[] = ["h264", "hevc", "av1", "vp9"];

export interface ProbeSize {
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_PROBE_SIZE: ProbeSize = { width: 1920, height: 1080, fps: 60 };

async function supported(
  probe: VideoEncoderProbe,
  codec: Codec,
  size: ProbeSize,
  pref: HardwarePreference,
): Promise<boolean> {
  try {
    const config = buildVideoEncoderConfig(
      { codec, container: codec === "vp9" ? "webm" : "mp4", quality: "High", ...size },
      pref,
    );
    return (await probe.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

export async function probeEncoderCapabilities(
  probe: VideoEncoderProbe,
  size: ProbeSize = DEFAULT_PROBE_SIZE,
): Promise<EncoderCapabilities> {
  const entries = await Promise.all(
    PROBE_CODECS.map(async (codec) => {
      const [hardware, software] = await Promise.all([
        supported(probe, codec, size, "prefer-hardware"),
        supported(probe, codec, size, "prefer-software"),
      ]);
      return [codec, { hardware, software }] as const;
    }),
  );
  return Object.fromEntries(entries) as EncoderCapabilities;
}

export const NO_CAPABILITIES: EncoderCapabilities = {
  h264: { hardware: false, software: false },
  hevc: { hardware: false, software: false },
  av1: { hardware: false, software: false },
  vp9: { hardware: false, software: false },
};

export const isCodecUsable = (caps: EncoderCapabilities, codec: Codec): boolean =>
  caps[codec].hardware || caps[codec].software;

/** Hardware availability in the shape `selectRoute` expects. */
export function hardwareCaps(caps: EncoderCapabilities): EncoderCaps {
  return {
    h264: caps.h264.hardware,
    hevc: caps.hevc.hardware,
    av1: caps.av1.hardware,
    vp9: caps.vp9.hardware,
  };
}

/** Reason shown next to an unusable codec, in the active window language. */
export const unsupportedCodecReason = (): string => t("exportFlow.issue.codecUnsupported");

export function unsupportedCodecs(
  caps: EncoderCapabilities | null,
): Partial<Record<Codec, string>> {
  if (!caps) return {};
  const out: Partial<Record<Codec, string>> = {};
  for (const codec of PROBE_CODECS) {
    if (!isCodecUsable(caps, codec)) out[codec] = unsupportedCodecReason();
  }
  return out;
}

export interface EncoderCapabilityCache {
  get(): Promise<EncoderCapabilities>;
  /** Last resolved value, if any (sync, for first paint). */
  peek(): EncoderCapabilities | null;
  clear(): void;
}

export function createEncoderCapabilityCache(
  probe: VideoEncoderProbe | null,
  size: ProbeSize = DEFAULT_PROBE_SIZE,
): EncoderCapabilityCache {
  let pending: Promise<EncoderCapabilities> | null = null;
  let value: EncoderCapabilities | null = null;
  return {
    get() {
      if (!probe) return Promise.resolve(NO_CAPABILITIES);
      pending ??= probeEncoderCapabilities(probe, size).then(
        (caps) => {
          value = caps;
          return caps;
        },
        (e: unknown) => {
          pending = null;
          throw e;
        },
      );
      return pending;
    },
    peek: () => value,
    clear() {
      pending = null;
      value = null;
    },
  };
}

let sessionCache: EncoderCapabilityCache | null = null;

/** Session-wide cache over the real `VideoEncoder` global (all unsupported without WebCodecs). */
export function sessionEncoderCapabilities(): EncoderCapabilityCache {
  sessionCache ??= createEncoderCapabilityCache(
    typeof VideoEncoder === "undefined"
      ? null
      : { isConfigSupported: (c) => VideoEncoder.isConfigSupported(c) },
  );
  return sessionCache;
}
