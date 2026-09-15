/**
 * Renderer-side port onto the main-process recording session (ENGINEERING_SPEC
 * §3 `recording:*`, §5.6). The app wires it to `window.reelform` IPC
 * (`src/app/recording/port.ts`); tests use fakes. Nothing in this folder
 * imports the IPC client directly.
 *
 * Track names and event shapes mirror `electron/recording/contracts.ts`; the
 * app port maps main's events onto {@link RecordingEvent} explicitly.
 */

/** Same names as main's `Track`: the screen video track is `screen`. */
export type TrackKind = "screen" | "mic" | "system" | "webcam";

/** Sent with the first screen chunk so main can align telemetry (§5.6). */
export interface ChunkTiming {
  /** `performance.timeOrigin` (epoch ms). */
  timeOriginMs: number;
  /** `performance.now()` right before `MediaRecorder.start`. */
  recorderStartMs: number;
  /** `performance.now()` at the first non-empty `dataavailable`. */
  firstDataMs?: number | undefined;
  timesliceMs?: number | undefined;
}

export interface WriteChunkRequest {
  sessionId: string;
  track: TrackKind;
  /** 0-based, strictly increasing per track, no gaps (main enforces it). */
  seq: number;
  chunk: ArrayBuffer;
  timing?: ChunkTiming | undefined;
}

export interface EndTrackRequest {
  sessionId: string;
  track: TrackKind;
  /** Number of chunks written (= last seq + 1). */
  chunkCount: number;
  mimeType: string;
}

export type InterruptReasonCode =
  | "displayDisconnected"
  | "helperCrash"
  | "diskLow"
  | "deviceLost"
  | "other";

/** `recording:event` (main → renderer), renderer vocabulary (`elapsedMs`, 0..1 mic level). */
export type RecordingEvent =
  | { sessionId: string; type: "countdown"; remaining: number }
  | { sessionId: string; type: "started"; backend: string }
  | { sessionId: string; type: "paused"; elapsedMs: number }
  | { sessionId: string; type: "resumed"; elapsedMs: number }
  | {
      sessionId: string;
      type: "stats";
      /** Recording time excluding pauses. */
      elapsedMs: number;
      fps: number;
      droppedFrames: number;
      fileBytes: number;
      /** Native backends only: helper RMS mapped to the meter's 0..1 scale. */
      micLevel?: number | undefined;
    }
  | { sessionId: string; type: "stopped"; elapsedMs: number; reason: "user" | "maxLength" }
  | {
      sessionId: string;
      type: "interrupted";
      reason: InterruptReasonCode;
      message?: string | undefined;
      /** Everything up to here is saved ("Recording saved up to 00:42"). */
      elapsedMs: number;
    }
  | { sessionId: string; type: "diskLow"; freeBytes: number }
  | { sessionId: string; type: "deviceLost"; device: string }
  | { sessionId: string; type: "discarded" }
  | { sessionId: string; type: "error"; code: string; message: string };

export type RecordingEventType = RecordingEvent["type"];

export interface RecordingPort {
  pause(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  discard(sessionId: string): Promise<void>;
  /** `recording:writeChunk` — append one chunk to the track's file on disk. */
  writeChunk(req: WriteChunkRequest): Promise<void>;
  /** `recording:endTrack` — all chunks for a track have been written. */
  endTrack(req: EndTrackRequest): Promise<void>;
  /** Subscribe to `recording:event` (main→renderer). Returns an unsubscribe. */
  subscribe(listener: (event: RecordingEvent) => void): () => void;
}

/** Stable error shape (§3). */
export interface RecordingError {
  code: string;
  message: string;
  details?: unknown;
}

export function toRecordingError(err: unknown, fallbackCode = "recording-failed"): RecordingError {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; name?: unknown; details?: unknown };
    const code =
      typeof e.code === "string" ? e.code : typeof e.name === "string" ? e.name : fallbackCode;
    const message = typeof e.message === "string" ? e.message : String(err);
    return e.details === undefined ? { code, message } : { code, message, details: e.details };
  }
  return { code: fallbackCode, message: String(err) };
}
