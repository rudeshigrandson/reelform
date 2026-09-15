import { z } from "zod";
import { MediaError } from "./errors";
import { parseClockTime } from "./progress";

/**
 * ffprobe JSON (`-print_format json -show_format -show_streams`) → the fields of
 * a project `MediaSource` (ENGINEERING_SPEC §4) minus its project-relative path.
 */

export const ProbeResult = z.object({
  durationMs: z.number().finite().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  codec: z.string(),
  hasAudio: z.boolean(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;

export function buildProbeArgs(input: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input];
}

interface RawStream {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  avg_frame_rate?: unknown;
  r_frame_rate?: unknown;
  duration?: unknown;
  tags?: Record<string, unknown>;
  side_data_list?: Array<{ rotation?: unknown }>;
  disposition?: { attached_pic?: unknown };
}

const toNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** `"60000/1001"` → 59.94…; `"0/0"`, `"N/A"` → null. */
export function parseFrameRate(v: unknown): number | null {
  if (typeof v !== "string") return toNumber(v);
  const [n, d] = v.split("/");
  const num = toNumber(n);
  if (d === undefined) return num !== null && num > 0 ? num : null;
  const den = toNumber(d);
  if (num === null || den === null || den === 0) return null;
  const r = num / den;
  return r > 0 && Number.isFinite(r) ? r : null;
}

const secondsToMs = (v: unknown): number | null => {
  const s = toNumber(v);
  return s !== null && s >= 0 ? s * 1000 : null;
};

/** Matroska/WebM from MediaRecorder often has only a `DURATION` tag on the stream. */
const tagDurationMs = (tags: Record<string, unknown> | undefined): number | null => {
  if (!tags) return null;
  const entry = Object.entries(tags).find(([k]) => k.toUpperCase() === "DURATION");
  const ms = typeof entry?.[1] === "string" ? parseClockTime(entry[1]) : null;
  return ms !== null && ms >= 0 ? ms : null;
};

export function parseProbeJson(raw: string | unknown): ProbeResult {
  let doc: unknown = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new MediaError("MEDIA_PROBE_FAILED", "ffprobe output is not JSON");
    }
  }
  if (typeof doc !== "object" || doc === null) {
    throw new MediaError("MEDIA_PROBE_FAILED", "ffprobe output is not an object");
  }
  const { streams, format } = doc as { streams?: unknown; format?: { duration?: unknown } };
  const list: RawStream[] = Array.isArray(streams) ? (streams as RawStream[]) : [];

  const video = list.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  if (!video) throw new MediaError("MEDIA_PROBE_NO_VIDEO", "No video stream found");

  let width = toNumber(video.width);
  let height = toNumber(video.height);
  if (width === null || height === null || width <= 0 || height <= 0) {
    throw new MediaError("MEDIA_PROBE_FAILED", "Video stream has no dimensions");
  }
  const rotation = toNumber(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation);
  if (rotation !== null && Math.abs(Math.round(rotation)) % 180 === 90) {
    [width, height] = [height, width];
  }

  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate);
  if (fps === null) throw new MediaError("MEDIA_PROBE_FAILED", "Video stream has no frame rate");

  const durationMs =
    secondsToMs(format?.duration) ?? secondsToMs(video.duration) ?? tagDurationMs(video.tags);
  if (durationMs === null) {
    throw new MediaError("MEDIA_PROBE_NO_DURATION", "Container reports no duration");
  }

  return ProbeResult.parse({
    durationMs,
    width: Math.round(width),
    height: Math.round(height),
    fps,
    codec: typeof video.codec_name === "string" ? video.codec_name : "unknown",
    hasAudio: list.some((s) => s.codec_type === "audio"),
  });
}
