/**
 * Errors thrown by media handlers carry a stable `code` (ENGINEERING_SPEC §3) so
 * the renderer can pick copy without parsing messages.
 */
export type MediaErrorCode =
  | "MEDIA_INVALID_ROOT_ID"
  | "MEDIA_ROOT_NOT_ABSOLUTE"
  | "MEDIA_ROOT_NOT_DIRECTORY"
  | "MEDIA_ROOT_NOT_FOUND"
  | "MEDIA_PATH_NOT_ABSOLUTE"
  | "MEDIA_PROBE_FAILED"
  | "MEDIA_PROBE_NO_VIDEO"
  | "MEDIA_PROBE_NO_DURATION"
  | "MEDIA_THUMBNAIL_FAILED"
  | "MEDIA_INVALID_ARGS"
  | "FFMPEG_NOT_FOUND"
  | "FFMPEG_SPAWN_FAILED"
  | "FFMPEG_FAILED"
  | "FFMPEG_CANCELLED"
  | "FFMPEG_OUTPUT_TOO_LARGE";

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly details: unknown;

  constructor(code: MediaErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "MediaError";
    this.code = code;
    this.details = details;
  }
}
