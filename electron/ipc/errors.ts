import type { IpcError } from "./contracts";

/**
 * IpcError transport over Electron invoke. Electron keeps only `message` from a
 * handler's thrown error (and wraps it as "Error invoking remote method 'x':
 * Error: <message>"), so main encodes `{ code, message, details? }` as JSON after
 * a marker and the renderer decodes it. Pure: shared by main and renderer.
 */

export const IPC_ERROR_PREFIX = "__reelform_ipc_error__:";

function hasCode(err: unknown): err is { code: string; message?: unknown; details?: unknown } {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string";
}

/** Normalise anything a handler throws into an IpcError. */
export function toIpcError(err: unknown): IpcError {
  if (typeof err === "object" && err !== null) {
    const withSerializer = err as { toIpcError?: unknown };
    if (typeof withSerializer.toIpcError === "function") {
      return (withSerializer.toIpcError as () => IpcError)();
    }
    // zod validation failures carry `issues`; surface them as a stable code.
    if ((err as { name?: unknown }).name === "ZodError") {
      return {
        code: "INVALID_PAYLOAD",
        message: "IPC payload failed validation",
        details: (err as { issues?: unknown }).issues,
      };
    }
  }
  if (hasCode(err)) {
    const message = typeof err.message === "string" ? err.message : err.code;
    return err.details === undefined
      ? { code: err.code, message }
      : { code: err.code, message, details: err.details };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL", message };
}

/** Renderer-side typed error carrying the main-process IpcError. */
export class ReelformIpcError extends Error implements IpcError {
  readonly code: string;
  readonly details?: unknown;
  constructor(e: IpcError) {
    super(e.message);
    this.name = "ReelformIpcError";
    this.code = e.code;
    if (e.details !== undefined) this.details = e.details;
  }
}

/** Decode an error rejected by `ipcRenderer.invoke`; null when it isn't one of ours. */
export function decodeIpcError(err: unknown): IpcError | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : null;
  if (message === null) return null;
  const at = message.indexOf(IPC_ERROR_PREFIX);
  if (at === -1) return null;
  try {
    const parsed: unknown = JSON.parse(message.slice(at + IPC_ERROR_PREFIX.length));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { code?: unknown }).code === "string" &&
      typeof (parsed as { message?: unknown }).message === "string"
    ) {
      return parsed as IpcError;
    }
  } catch {
    // Not JSON after the marker: fall through to null.
  }
  return null;
}
