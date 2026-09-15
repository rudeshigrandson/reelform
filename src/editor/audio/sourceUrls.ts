import type { Telemetry } from "../autozoom/types";
import type { AudioRegion } from "../inspector/audio/types";
import type { CursorSettings } from "../inspector/cursor/types";
import { sourceToTimelineMs } from "../inspector/host/timeMap";
import type { Clip } from "../model/schema";
import type { ClickEvent } from "./graph";

/**
 * Audio graph inputs shared by the preview player and the export mixdown
 * (ENGINEERING_SPEC §6.6, §9.5): media URLs for extra regions and click-sound
 * packs, and telemetry clicks placed on timeline time.
 */

/** Bundled click packs live in `public/sounds/<pack>/click.wav`. */
export const CLICK_SOUND_BASE_URL = "/sounds";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * URL for a project file: media-protocol URLs pass through; project-relative
 * paths are resolved against the `reelform-media://` base. Absolute file paths
 * can't be served and resolve to null.
 */
export function projectMediaUrl(
  mediaBaseUrl: string | null,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  if (SCHEME.test(path) && !WINDOWS_ABSOLUTE.test(path)) return path;
  if (!mediaBaseUrl || path.startsWith("/") || WINDOWS_ABSOLUTE.test(path)) return null;
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  return parts.length > 0 ? `${mediaBaseUrl}${parts.map(encodeURIComponent).join("/")}` : null;
}

export type ClickSoundSettings = CursorSettings["clickSound"];

/** Click sound URL for the cursor setting; null for "none" or an unservable custom file. */
export function clickSoundUrl(
  clickSound: ClickSoundSettings,
  mediaBaseUrl: string | null,
  baseUrl = CLICK_SOUND_BASE_URL,
): string | null {
  switch (clickSound.type) {
    case "none":
      return null;
    case "custom":
      return projectMediaUrl(mediaBaseUrl, clickSound.customSound?.path);
    default:
      return `${baseUrl}/${clickSound.type}/click.wav`;
  }
}

export interface RegionSourceUrl {
  id: string;
  url: string;
}

/** Decodable URLs for extra audio regions (regions without one are skipped). */
export function regionSourceUrls(
  regions: readonly Pick<AudioRegion, "id" | "path">[],
  mediaBaseUrl: string | null,
): RegionSourceUrl[] {
  const out: RegionSourceUrl[] = [];
  for (const r of regions) {
    const url = projectMediaUrl(mediaBaseUrl, r.path);
    if (url !== null) out.push({ id: r.id, url });
  }
  return out;
}

/**
 * Mouse-down clicks on timeline ms, sorted. Clicks inside trimmed-away source
 * ranges are dropped; with no clips, source time is timeline time.
 */
export function clickEventsFromTelemetry(
  telemetry: Pick<Telemetry, "clicks"> | null | undefined,
  clips: readonly Clip[],
): ClickEvent[] {
  if (!telemetry) return [];
  const out: ClickEvent[] = [];
  for (const c of telemetry.clicks) {
    if (c[4] !== "down" || !Number.isFinite(c[0])) continue;
    const tMs = clips.length > 0 ? sourceToTimelineMs(clips, c[0]) : c[0];
    if (tMs !== null && tMs >= 0) out.push({ tMs });
  }
  return out.sort((a, b) => a.tMs - b.tMs);
}
