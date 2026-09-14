/**
 * Stable, IpcError-shaped failures for the project + export file layer
 * (ENGINEERING_SPEC §3: errors are `{ code, message, details? }` with stable
 * `code` strings the UI uses to pick copy).
 */

export type FsErrorCode =
  | "INVALID_PATH"
  | "PATH_OUTSIDE_ROOT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_EXISTS"
  | "PROJECT_CORRUPT"
  | "PROJECT_INVALID"
  | "NO_BACKUP"
  | "RELINK_FILE_NOT_FOUND"
  | "RELINK_PROBE_FAILED"
  | "RELINK_DURATION_MISMATCH"
  | "RELINK_DIMENSION_MISMATCH"
  | "TRASH_FAILED"
  | "EXPORT_NOT_FOUND"
  | "EXPORT_CLOSED"
  | "EXPORT_CANCELLED"
  | "EXPORT_WRITE_FAILED"
  | "INVALID_NAME";

export interface IpcErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class FsIpcError extends Error {
  readonly code: FsErrorCode;
  readonly details: unknown;

  constructor(code: FsErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "FsIpcError";
    this.code = code;
    this.details = details;
  }

  /** Plain `{ code, message, details? }` for sending over IPC. */
  toIpcError(): IpcErrorShape {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export const isFsIpcError = (e: unknown): e is FsIpcError => e instanceof FsIpcError;

/** Node errno code of an fs error, if any. */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}
