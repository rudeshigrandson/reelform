/**
 * Export route selection (ENGINEERING_SPEC §10.1).
 *
 * `selectRoute` decides which of the three export engines to run for a given
 * output config, a set of project feature flags, and the hardware-encoder
 * capabilities probed on this machine (`export:probeEncoders`).
 *
 * Routes:
 *   - 'native-static'      — ffmpeg fast path. ONLY when the project uses nothing
 *                            but frame styling + trims (no zooms/cursor/annotations/
 *                            webcam/captions/speeds). 5–10× faster.
 *   - 'software-fallback'  — WebCodecs with `hardwareAcceleration:'prefer-software'`,
 *                            chosen when the HW encoder for the selected codec is
 *                            unavailable/rejected.
 *   - 'webcodecs'          — default GPU-accelerated WebCodecs path.
 *
 * Pure and deterministic: the function reads only its arguments. The real project
 * document is reduced to `ProjectFlags` by the caller so this stays testable and
 * independent of the full schema.
 */

import type { Codec } from "./bitrate.js";

/** Output settings for an export. */
export interface ExportConfig {
  codec: Codec;
  container: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  quality: "High" | "Max";
}

/**
 * Which time-based / composited features the project actually uses. Derived from
 * the real project document by the caller; the route logic is pure over these.
 * If every flag is false the project is "styling + trims only".
 */
export interface ProjectFlags {
  hasZooms: boolean;
  hasCursor: boolean;
  hasAnnotations: boolean;
  hasWebcam: boolean;
  hasCaptions: boolean;
  hasSpeeds: boolean;
}

/** Hardware-encoder availability per codec (from `export:probeEncoders`). */
export interface EncoderCaps {
  h264: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
}

export type ExportRoute = "webcodecs" | "native-static" | "software-fallback";

/**
 * True when the project only needs frame styling + trims — no zooms, cursor
 * rendering, annotations, webcam, captions or speed regions. This is the
 * precondition for the ffmpeg `native-static` fast path.
 */
function isStylingOnly(flags: ProjectFlags): boolean {
  return (
    !flags.hasZooms &&
    !flags.hasCursor &&
    !flags.hasAnnotations &&
    !flags.hasWebcam &&
    !flags.hasCaptions &&
    !flags.hasSpeeds
  );
}

/** Whether hardware encoding is available for the config's chosen codec. */
function hwAvailable(caps: EncoderCaps, codec: Codec): boolean {
  return caps[codec];
}

/**
 * Choose the export engine.
 *
 * Precedence:
 *   1. `native-static` when the project is styling-only AND the chosen codec has
 *      a hardware encoder (the fast path is an ffmpeg HW filter graph — without a
 *      HW encoder it offers no benefit, so we drop back to software WebCodecs).
 *   2. `software-fallback` when the chosen codec's hardware encoder is unavailable.
 *   3. `webcodecs` otherwise (default).
 */
export function selectRoute(
  config: ExportConfig,
  project: ProjectFlags,
  caps: EncoderCaps,
): ExportRoute {
  const hw = hwAvailable(caps, config.codec);

  if (isStylingOnly(project)) {
    // Fast path needs a hardware encoder to be worthwhile; otherwise fall back
    // to the software WebCodecs route.
    return hw ? "native-static" : "software-fallback";
  }

  if (!hw) {
    return "software-fallback";
  }

  return "webcodecs";
}
