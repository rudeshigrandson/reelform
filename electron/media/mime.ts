/**
 * Content types for files served over `reelform-media://` (ENGINEERING_SPEC §2).
 * Only the media, image, telemetry and caption formats a project folder holds;
 * everything else is served as opaque bytes.
 */

export const DEFAULT_MIME = "application/octet-stream";

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  m4a: "audio/mp4",
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json",
  gz: "application/gzip",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};

/** Lower-cased extension of the last path segment, without the dot ("" when none). */
export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** MIME type by file extension; unknown or missing extension → octet-stream. */
export function mimeForPath(path: string): string {
  return MIME_BY_EXT[extensionOf(path)] ?? DEFAULT_MIME;
}
