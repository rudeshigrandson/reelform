import type { MediaConstraintsLike } from "./media";

/**
 * getUserMedia constraint builders for the Electron capture backend
 * (ENGINEERING_SPEC §5.2). Pure; no DOM access.
 */

export type Platform = "darwin" | "win32" | "linux";
export type CaptureFps = 30 | 60;
export type WebcamQuality = "720p" | "1080p";

export interface SizeDip {
  width: number;
  height: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

/** Stable reason codes used by the UI to pick copy. */
export const UNSUPPORTED_SYSTEM_AUDIO_MAC = "system-audio-unsupported-macos";

const safeScale = (s: number | undefined): number =>
  s !== undefined && Number.isFinite(s) && s > 0 ? s : 1;

/**
 * Source pixel size: DIP bounds × scaleFactor, rounded down to even numbers
 * (video encoders reject odd dimensions), at least 2×2.
 */
export function sourcePixelSize(size: SizeDip, scaleFactor?: number | undefined): PixelSize {
  const scale = safeScale(scaleFactor);
  const px = (v: number): number => {
    const n = Number.isFinite(v) && v > 0 ? Math.floor(v * scale) : 0;
    return Math.max(2, n - (n % 2));
  };
  return { width: px(size.width), height: px(size.height) };
}

export interface DesktopConstraintOptions {
  sourceId: string;
  /** Source bounds in DIP; omit for windows whose size is unknown (browser picks native). */
  size?: SizeDip | undefined;
  scaleFactor?: number | undefined;
  fps?: CaptureFps | undefined;
}

/** Desktop (display or window) video, target 60fps at native pixel size. */
export function buildDesktopConstraints(opts: DesktopConstraintOptions): MediaConstraintsLike {
  const fps = opts.fps ?? 60;
  const px = opts.size ? sourcePixelSize(opts.size, opts.scaleFactor) : undefined;
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: opts.sourceId,
        ...(px
          ? { minWidth: px.width, maxWidth: px.width, minHeight: px.height, maxHeight: px.height }
          : {}),
        minFrameRate: fps,
        maxFrameRate: fps,
      },
    },
  };
}

/** Microphone: raw-ish voice capture; processing is done in the editor (§9.5). */
export function buildMicConstraints(deviceId?: string | undefined): MediaConstraintsLike {
  return {
    audio: {
      ...(deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
    },
    video: false,
  };
}

export type SystemAudioResult =
  | { ok: true; constraints: MediaConstraintsLike }
  | { ok: false; reason: string };

/**
 * System loopback audio. Chromium only delivers desktop audio together with a
 * desktop video request, so the constraints carry both; the capture session
 * splits the audio tracks into their own recorder. macOS has no loopback on
 * this backend (the UI shows the limitation). Linux additionally needs PipeWire,
 * which only surfaces at getUserMedia time.
 */
export function buildSystemAudioConstraints(
  platform: Platform,
  desktop: DesktopConstraintOptions,
): SystemAudioResult {
  if (platform === "darwin") return { ok: false, reason: UNSUPPORTED_SYSTEM_AUDIO_MAC };
  const base = buildDesktopConstraints(desktop);
  return {
    ok: true,
    constraints: {
      audio: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: desktop.sourceId } },
      video: base.video,
    },
  };
}

export const WEBCAM_SIZES: Record<WebcamQuality, PixelSize> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};
export const WEBCAM_FPS = 30;

/** Webcam: 1280×720@30 by default, 1080p optional. */
export function buildWebcamConstraints(
  deviceId?: string | undefined,
  quality: WebcamQuality = "720p",
): MediaConstraintsLike {
  const size = WEBCAM_SIZES[quality];
  return {
    audio: false,
    video: {
      ...(deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: size.width },
      height: { ideal: size.height },
      frameRate: { ideal: WEBCAM_FPS },
    },
  };
}
