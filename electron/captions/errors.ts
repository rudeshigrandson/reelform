/**
 * Errors thrown by the captions runtime carry a stable `code` (ENGINEERING_SPEC
 * §3) so the renderer can pick copy without parsing messages.
 */
export type CaptionsErrorCode =
  | "unknown-model"
  | "model-not-installed"
  | "runtime-not-found"
  | "download-failed"
  | "checksum-mismatch"
  | "checksum-unavailable"
  | "cancelled"
  | "extract-failed"
  | "split-failed"
  | "whisper-failed"
  | "whisper-output-invalid"
  | "no-speech";

export class CaptionsError extends Error {
  readonly code: CaptionsErrorCode;
  readonly details: unknown;

  constructor(code: CaptionsErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CaptionsError";
    this.code = code;
    this.details = details;
  }
}

export function isCaptionsError(err: unknown, code?: CaptionsErrorCode): err is CaptionsError {
  return err instanceof CaptionsError && (code === undefined || err.code === code);
}
