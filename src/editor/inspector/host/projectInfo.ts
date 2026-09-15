import type { ProjectSessionData } from "../../../app/project/session";
import type { CaptureInfo } from "../../model/v1";
import { joinPath } from "../project/logic";
import type { ProjectInfo, SourceInfo, SourceStat } from "../project/types";

/**
 * Project tab view model from the open session (guide S21), replacing the
 * fixture. Sizes come from `host.statSources`; a `null` stat means missing.
 */

export const CAPTURE_BACKEND_LABELS: Readonly<Record<CaptureInfo["backend"], string>> = {
  sck: "ScreenCaptureKit",
  wgc: "Windows.Graphics.Capture",
  dxgi: "DXGI Desktop Duplication",
  electron: "Chromium desktop capture",
};

const SOURCE_ROLES = ["video", "mic", "system", "webcam"] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p);
}

export function absoluteSourcePath(projectPath: string | null, rel: string): string {
  if (isAbsolutePath(rel) || !projectPath) return rel;
  return joinPath(projectPath, rel);
}

export type SessionForInfo = Pick<
  ProjectSessionData,
  "projectPath" | "meta" | "telemetry" | "mediaOffline"
>;

/** Project-relative paths of every source present in meta. */
export function sourcePaths(session: Pick<ProjectSessionData, "meta">): string[] {
  const s = session.meta?.sources;
  if (!s) return [];
  return SOURCE_ROLES.flatMap((role) => (s[role] ? [s[role].path] : []));
}

export function projectInfoFromSession(
  session: SessionForInfo,
  stats: Readonly<Record<string, SourceStat>>,
  cursorPointCount: number | null,
): ProjectInfo | null {
  const meta = session.meta;
  if (!meta) return null;
  const location = session.projectPath ?? "";
  const sources: SourceInfo[] = [];
  for (const role of SOURCE_ROLES) {
    const src = meta.sources[role];
    if (!src) continue;
    const stat = stats[src.path];
    const missing = stat === null || (role === "video" && session.mediaOffline);
    sources.push({
      role,
      path: src.path,
      absolutePath: absoluteSourcePath(session.projectPath, src.path),
      sizeBytes: stat ? stat.sizeBytes : null,
      missing,
      durationMs: src.durationMs,
    });
  }
  const video = meta.sources.video;
  const audioTracks: string[] = [];
  if (meta.sources.mic) audioTracks.push("Microphone");
  if (meta.sources.system) audioTracks.push("System audio");
  if (audioTracks.length === 0 && video.hasAudio) audioTracks.push("Source audio");
  const backend = meta.sources.capture?.backend;
  const points = session.telemetry?.file.points.length ?? cursorPointCount;
  return {
    id: meta.id,
    name: meta.name,
    locationPath: location,
    createdAt: meta.createdAt,
    modifiedAt: meta.modifiedAt,
    sources,
    recording: {
      width: video.width,
      height: video.height,
      fps: video.fps,
      durationMs: video.durationMs,
      codec: video.codec,
      captureBackend: backend ? CAPTURE_BACKEND_LABELS[backend] : null,
      cursorPointCount: points !== null && points > 0 ? points : null,
      audioTracks,
    },
  };
}

/** Which role a source path belongs to. */
export function roleForPath(
  session: Pick<ProjectSessionData, "meta">,
  path: string,
): SourceRole | null {
  const s = session.meta?.sources;
  if (!s) return null;
  return SOURCE_ROLES.find((r) => s[r]?.path === path) ?? null;
}
