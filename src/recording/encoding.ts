import type { PixelSize } from "./constraints";

/**
 * MediaRecorder mime negotiation and bitrate table (ENGINEERING_SPEC §5.2).
 */

export const TIMESLICE_MS = 250;
export const MBPS = 1_000_000;
export const HIGH_FPS_MULTIPLIER = 1.7;
export const WEBCAM_BITRATE = 8 * MBPS;
export const MIC_BITRATE = 128_000;
export const SYSTEM_AUDIO_BITRATE = 192_000;

export type VideoCodec = "vp9" | "h264" | "vp8" | "webm";

export interface VideoMime {
  mimeType: string;
  codec: VideoCodec;
  container: "webm" | "mp4";
}

/** Preference order: VP9 WebM, then H.264 (WebM then MP4), then VP8, then bare WebM. */
export const VIDEO_MIME_CANDIDATES: readonly VideoMime[] = [
  { mimeType: "video/webm;codecs=vp9", codec: "vp9", container: "webm" },
  { mimeType: "video/webm;codecs=h264", codec: "h264", container: "webm" },
  { mimeType: "video/mp4;codecs=avc1", codec: "h264", container: "mp4" },
  { mimeType: "video/webm;codecs=vp8", codec: "vp8", container: "webm" },
  { mimeType: "video/webm", codec: "webm", container: "webm" },
];

export const AUDIO_MIME_CANDIDATES: readonly string[] = ["audio/webm;codecs=opus", "audio/webm"];

export type IsTypeSupported = (mimeType: string) => boolean;

const supported = (isTypeSupported: IsTypeSupported, mime: string): boolean => {
  try {
    return isTypeSupported(mime) === true;
  } catch {
    return false;
  }
};

/** First supported video mime, or null when the recorder supports none. */
export function negotiateVideoMime(isTypeSupported: IsTypeSupported): VideoMime | null {
  return VIDEO_MIME_CANDIDATES.find((c) => supported(isTypeSupported, c.mimeType)) ?? null;
}

/** First supported audio mime (opus/webm preferred), or null. */
export function negotiateAudioMime(isTypeSupported: IsTypeSupported): string | null {
  return AUDIO_MIME_CANDIDATES.find((m) => supported(isTypeSupported, m)) ?? null;
}

const PX_1080 = 1920 * 1080;
const PX_1440 = 2560 * 1440;

/** Base bitrate tier (at 30fps) for a pixel size: ≤1080p 18, ≤1440p 28, above 45 Mbps. */
export function baseVideoBitrate(size: PixelSize): number {
  const area = Math.max(0, size.width) * Math.max(0, size.height);
  if (!Number.isFinite(area) || area <= PX_1080) return 18 * MBPS;
  if (area <= PX_1440) return 28 * MBPS;
  return 45 * MBPS;
}

/** Screen video bitrate: table tier ×1.7 at 60fps (any fps above 30 counts as high). */
export function videoBitrate(size: PixelSize, fps: number): number {
  const base = baseVideoBitrate(size);
  return fps > 30 ? Math.round(base * HIGH_FPS_MULTIPLIER) : base;
}
