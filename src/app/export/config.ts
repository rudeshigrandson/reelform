import { type Codec, type Quality, exportBitrate } from "../../export/bitrate";
import { AUDIO_BITRATE } from "../../export/engine/audio";
import { containerSupports } from "../../export/engine/encoderConfig";
import type { GifDither, GifFps, GifSizePreset } from "../../export/gif/types";
import type { ExportConfig } from "../../export/route";
import { t } from "../../i18n/format";
import { type EncoderCapabilities, isCodecUsable } from "./capabilities";

/**
 * Export flow configuration (guide S22): everything the dialog collects, its
 * validation, and the derived engine config / file name / size estimate.
 */

export type ExportFormat = "mp4" | "webm" | "gif";
export type RangeChoice = "entire" | "selection" | "in-out";
export type CaptionsChoice = "none" | "burn-in" | "srt" | "vtt";
export type AudioChoice = "aac" | "mute";
/** §10.6: one median-cut palette from sampled frames, or a local palette per frame. */
export type GifPalette = "global" | "adaptive";

export interface GifOptions {
  sizePreset: GifSizePreset;
  fps: GifFps;
  loop: boolean;
  dither: GifDither;
  colors: number;
  palette: GifPalette;
}

export interface ExportFlowConfig {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  codec: Codec;
  quality: Quality;
  audio: AudioChoice;
  /** "Hardware acceleration (auto)"; off forces the software encoder. */
  hardwareAcceleration: boolean;
  gif: GifOptions;
  range: RangeChoice;
  captions: CaptionsChoice;
  /** Without extension. */
  fileName: string;
  /** Absolute folder; null → the project's `exports/` folder. */
  destinationDir: string | null;
  revealAfter: boolean;
  copyAfter: boolean;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface RangeSources {
  durationMs: number;
  selection?: TimeRange | null | undefined;
  inOut?: TimeRange | null | undefined;
}

export const DEFAULT_GIF_OPTIONS: GifOptions = {
  sizePreset: 720,
  fps: 15,
  loop: true,
  dither: "bayer4",
  colors: 256,
  palette: "global",
};

export function defaultFlowConfig(fileName = "Export"): ExportFlowConfig {
  return {
    format: "mp4",
    width: 1920,
    height: 1080,
    fps: 60,
    codec: "h264",
    quality: "High",
    audio: "aac",
    hardwareAcceleration: true,
    gif: { ...DEFAULT_GIF_OPTIONS },
    range: "entire",
    captions: "none",
    fileName,
    destinationDir: null,
    revealAfter: false,
    copyAfter: false,
  };
}

const validRange = (r: TimeRange | null | undefined, durationMs: number): TimeRange | null => {
  if (!r || !Number.isFinite(r.startMs) || !Number.isFinite(r.endMs)) return null;
  const startMs = Math.max(0, Math.min(r.startMs, durationMs));
  const endMs = Math.max(0, Math.min(r.endMs, durationMs));
  return endMs > startMs ? { startMs, endMs } : null;
};

/** Timeline range for a choice, clamped to the project; null when unavailable/empty. */
export function resolveRange(choice: RangeChoice, src: RangeSources): TimeRange | null {
  const durationMs = Number.isFinite(src.durationMs) ? Math.max(0, src.durationMs) : 0;
  switch (choice) {
    case "entire":
      return durationMs > 0 ? { startMs: 0, endMs: durationMs } : null;
    case "selection":
      return validRange(src.selection, durationMs);
    case "in-out":
      return validRange(src.inOut, durationMs);
  }
}

export const extensionFor = (format: ExportFormat): string => format;

const ILLEGAL = /[<>:"\/\\|?*]/g;

/** Strip characters no desktop file system accepts (incl. control characters). */
function cleanName(name: string): string {
  let out = "";
  for (const ch of name.replace(ILLEGAL, "")) if (ch.charCodeAt(0) >= 32) out += ch;
  return out.trim();
}

/** Safe file name with the right extension ("Demo" → "Demo.mp4"). */
export function outputFileName(fileName: string, format: ExportFormat): string {
  const ext = extensionFor(format);
  let base = cleanName(fileName);
  const lower = base.toLowerCase();
  for (const known of ["mp4", "webm", "gif"]) {
    if (lower.endsWith(`.${known}`)) base = base.slice(0, -(known.length + 1)).trim();
  }
  base = base.replace(/^\.+/, "").slice(0, 200);
  return `${base || "Export"}.${ext}`;
}

/** Name of a sidecar next to the final output ("/x/Demo (1).mp4" → "Demo (1).srt"). */
export function sidecarName(outputPath: string, ext: string): string {
  const file = outputPath.split(/[\\/]/).pop() ?? "Export";
  const dot = file.lastIndexOf(".");
  return `${dot > 0 ? file.slice(0, dot) : file}.${ext}`;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** GIF output size for a height preset, keeping the video aspect, never upscaling width parity. */
export function gifDimensions(
  preset: GifSizePreset,
  aspect: { width: number; height: number },
): { width: number; height: number } {
  const ratio = aspect.width > 0 && aspect.height > 0 ? aspect.width / aspect.height : 16 / 9;
  return { width: even(preset * ratio), height: even(preset) };
}

export function toEngineConfig(c: ExportFlowConfig): ExportConfig {
  return {
    codec: c.codec,
    container: c.format === "webm" ? "webm" : "mp4",
    width: c.width,
    height: c.height,
    fps: c.fps,
    quality: c.quality,
  };
}

export interface ValidationContext {
  range: RangeSources;
  caps: EncoderCapabilities | null;
  hasVideo: boolean;
  mediaOffline: boolean;
  captionCount: number;
}

export interface ConfigIssue {
  field: "fileName" | "range" | "codec" | "size" | "source" | "captions" | "gif";
  message: string;
}

export function validateFlowConfig(c: ExportFlowConfig, ctx: ValidationContext): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (cleanName(c.fileName).replace(/^\.+/, "") === "") {
    issues.push({ field: "fileName", message: t("exportFlow.issue.fileName") });
  }
  if (!ctx.hasVideo || ctx.mediaOffline) {
    issues.push({ field: "source", message: t("exportFlow.issue.sourceMissing") });
  }
  if (!resolveRange(c.range, ctx.range)) {
    issues.push({
      field: "range",
      message:
        c.range === "entire"
          ? t("exportFlow.issue.emptyProject")
          : c.range === "selection"
            ? t("exportFlow.issue.selectRange")
            : t("exportFlow.issue.setInOut"),
    });
  }
  if (c.captions !== "none" && ctx.captionCount === 0) {
    issues.push({ field: "captions", message: t("exportFlow.issue.noCaptions") });
  }
  if (c.format === "gif") {
    if (c.captions === "srt" || c.captions === "vtt") {
      // Sidecars next to a GIF are allowed; nothing to validate.
    }
    if (!(c.gif.colors >= 32 && c.gif.colors <= 256)) {
      issues.push({
        field: "gif",
        message: t("exportFlow.issue.gifColors", { min: 32, max: 256 }),
      });
    }
    return issues;
  }
  const engine = toEngineConfig(c);
  if (
    !Number.isInteger(c.width) ||
    !Number.isInteger(c.height) ||
    c.width <= 0 ||
    c.height <= 0 ||
    c.width % 2 !== 0 ||
    c.height % 2 !== 0
  ) {
    issues.push({ field: "size", message: t("exportFlow.issue.size") });
  }
  if (!containerSupports(engine.container, c.codec)) {
    issues.push({
      field: "codec",
      message: t("exportFlow.issue.codecNotWebm", { codec: c.codec.toUpperCase() }),
    });
  } else if (ctx.caps && !isCodecUsable(ctx.caps, c.codec)) {
    issues.push({ field: "codec", message: t("exportFlow.issue.codecUnsupported") });
  }
  return issues;
}

/** Estimated MP4/WebM bytes from the bitrate table (+ AAC/Opus 192k when not muted). */
export function estimateVideoBytes(c: ExportFlowConfig, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  const video = exportBitrate(c.width, c.height, c.fps, c.codec, c.quality);
  const audio = c.audio === "aac" ? AUDIO_BITRATE : 0;
  return Math.round(((video + audio) * durationMs) / 1000 / 8);
}

/**
 * Pre-export GIF guess (the live estimate from the first 2s replaces it once
 * encoding starts): ~0.12 bytes per pixel for the first frame, ~12% of that for
 * each differenced frame, scaled by palette size. An adaptive palette adds a
 * local color table (3 bytes per color) to every frame.
 */
export function roughGifBytes(
  width: number,
  height: number,
  fps: number,
  colors: number,
  durationMs: number,
  palette: GifPalette = "global",
): number {
  if (!(durationMs > 0) || !(width > 0) || !(height > 0) || !(fps > 0)) return 0;
  const frames = Math.max(1, Math.ceil((durationMs * fps) / 1000));
  const clamped = Math.max(2, Math.min(256, colors));
  const colorFactor = Math.log2(clamped) / 8;
  const first = width * height * 0.12 * colorFactor;
  const localTables = palette === "adaptive" ? frames * clamped * 3 : 0;
  return Math.round(800 + first + first * 0.12 * (frames - 1) + localTables);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
