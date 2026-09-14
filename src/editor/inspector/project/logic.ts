import type { Clip, Project } from "../../model/schema";
import type { DateFormatOptions, ProjectFsMeta, ProjectInfo, SourceInfo } from "./types";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Human byte size, base 1024: "0 B", "512 B", "1.5 KB", "466 MB", "1.2 GB".
 * One decimal below 10 units (trailing ".0" dropped), whole numbers above.
 * Negative / non-finite input renders as "—".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  let rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  // Rounding can hit the next unit boundary (e.g. 1023.7 KB → "1024 KB").
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    unit += 1;
    rounded = 1;
  }
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

/** Date + time for created / modified rows. Invalid ISO renders as "—". */
export function formatDateTime(iso: string, opts: DateFormatOptions = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(opts.locale ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(d);
}

/** Duration readout "mm:ss.mmm", or "h:mm:ss.mmm" at one hour and above. */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  const millis = total % 1000;
  const totalSec = Math.floor(total / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  const tail = `${String(sec).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  return hours > 0
    ? `${hours}:${String(min).padStart(2, "0")}:${tail}`
    : `${String(min).padStart(2, "0")}:${tail}`;
}

/** Join project dir + relative source path, keeping the dir's separator style. */
export function joinPath(dir: string, rel: string): string {
  if (!dir) return rel;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmedDir = dir.replace(/[\\/]+$/, "");
  const trimmedRel = rel.replace(/^[\\/]+/, "").replace(/^\.[\\/]/, "");
  return `${trimmedDir}${sep}${trimmedRel}`;
}

/** Build the inspector view model from the document + fs metadata. */
export function buildProjectInfo(project: Project, meta: ProjectFsMeta): ProjectInfo {
  const video = project.sources.video;
  const stat = meta.sourceStats[video.path];
  const source: SourceInfo = {
    role: "video",
    path: video.path,
    absolutePath: joinPath(meta.locationPath, video.path),
    sizeBytes: stat ? stat.sizeBytes : null,
    missing: stat === null,
    durationMs: video.durationMs,
  };
  return {
    id: project.id,
    name: project.name,
    locationPath: meta.locationPath,
    createdAt: project.createdAt,
    modifiedAt: project.modifiedAt,
    sources: [source],
    recording: {
      width: video.width,
      height: video.height,
      fps: video.fps,
      durationMs: video.durationMs,
      codec: video.codec,
      captureBackend: meta.captureBackend ?? null,
      cursorPointCount: meta.cursorPointCount ?? null,
      audioTracks: meta.audioTracks ?? (video.hasAudio ? ["Source audio"] : []),
    },
  };
}

/** Total source milliseconds covered by the union of clip ranges, clamped to [0, sourceDurationMs]. */
export function usedSourceMs(clips: readonly Clip[], sourceDurationMs: number): number {
  const ranges = clips
    .map((c) => [Math.max(0, c.sourceStartMs), Math.min(sourceDurationMs, c.sourceEndMs)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let used = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of ranges) {
    if (s > curEnd) {
      if (curEnd > curStart) used += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) used += curEnd - curStart;
  return used;
}

/**
 * Bytes saved by trimming the source to the used timeline range, assuming size
 * is proportional to duration. `null` when not computable (missing source,
 * unknown size, zero duration); `0` when every source ms is used.
 */
export function computeTrimSavingsBytes(
  clips: readonly Clip[],
  source: Pick<SourceInfo, "sizeBytes" | "missing" | "durationMs">,
): number | null {
  if (source.missing || source.sizeBytes === null || source.durationMs <= 0) return null;
  const used = usedSourceMs(clips, source.durationMs);
  const unusedFraction = Math.max(0, (source.durationMs - used) / source.durationMs);
  return Math.round(source.sizeBytes * unusedFraction);
}
