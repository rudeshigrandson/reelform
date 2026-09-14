/**
 * Renderer-side port onto the main-process recording session (ENGINEERING_SPEC
 * §3 `recording:*`, §5.6). The app wires it to `window.reelform` IPC; tests use
 * fakes. Nothing in this folder imports the IPC client directly.
 */

export type TrackKind = "video" | "mic" | "system" | "webcam";

export interface WriteChunkRequest {
  sessionId: string;
  track: TrackKind;
  /** 0-based, strictly increasing per track, no gaps. */
  seq: number;
  chunk: ArrayBuffer;
}

export interface EndTrackRequest {
  sessionId: string;
  track: TrackKind;
  /** Number of chunks written (= last seq + 1). */
  chunkCount: number;
  mimeType: string;
}

export type RecordingEventType =
  | "started"
  | "paused"
  | "resumed"
  | "stopped"
  | "interrupted"
  | "diskLow"
  | "deviceLost"
  | "stats";

export interface RecordingEvent {
  sessionId: string;
  type: RecordingEventType;
  /** `stats`: elapsed recording time excluding pauses. */
  elapsedMs?: number | undefined;
  fps?: number | undefined;
  droppedFrames?: number | undefined;
  fileBytes?: number | undefined;
  /** `interrupted` / `deviceLost` / `diskLow`: machine reason code. */
  reason?: string | undefined;
  message?: string | undefined;
}

export interface RecordingPort {
  pause(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  discard(sessionId: string): Promise<void>;
  /** `recording:writeChunk` — append one chunk to the track's file on disk. */
  writeChunk(req: WriteChunkRequest): Promise<void>;
  /** All chunks for a track have been written. */
  endTrack(req: EndTrackRequest): Promise<void>;
  /** Subscribe to `recording:event` (main→renderer). Returns an unsubscribe. */
  subscribe(listener: (event: RecordingEvent) => void): () => void;
}

/** Stable error shape (§3). */
export interface RecordingError {
  code: string;
  message: string;
}

export function toRecordingError(err: unknown, fallbackCode = "recording-failed"): RecordingError {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; name?: unknown };
    const code =
      typeof e.code === "string" ? e.code : typeof e.name === "string" ? e.name : fallbackCode;
    const message = typeof e.message === "string" ? e.message : String(err);
    return { code, message };
  }
  return { code: fallbackCode, message: String(err) };
}
