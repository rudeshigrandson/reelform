import { z } from "zod";
import {
  BackendId,
  ChunkTiming,
  Rect,
  SourceRef,
  Sources,
  StartRequest,
  Track,
} from "../capture/types";

/**
 * `recording:*` IPC channels (ENGINEERING_SPEC §3 / §5.6). Shapes match
 * `Channel` in electron/ipc/contracts.ts. Pure zod — safe for the renderer.
 */

export const SessionRequest = z.object({ sessionId: z.string() });
const Ok = z.object({ ok: z.literal(true) });

export const MediaRef = z.object({
  /** Absolute path on disk. */
  path: z.string(),
  bytes: z.number().nonnegative().optional(),
});
export type MediaRef = z.infer<typeof MediaRef>;

/** Mirrors `sources.telemetry` in the project schema (§4). */
export const TelemetryRef = z.object({
  path: z.string(),
  pointCount: z.number().int().nonnegative(),
  hasClicks: z.boolean(),
  hasKeys: z.boolean(),
  sampleHz: z.number().positive(),
});
export type TelemetryRef = z.infer<typeof TelemetryRef>;

export const InterruptReason = z.enum([
  "displayDisconnected",
  "helperCrash",
  "diskLow",
  "deviceLost",
  "other",
]);

export const RecordingMeta = z.object({
  backend: BackendId,
  backendReasons: z.array(z.string()),
  os: z.string(),
  appVersion: z.string(),
  createdAt: z.string(),
  source: SourceRef,
  region: Rect.optional(),
  scaleFactor: z.number().positive(),
  recordedFps: z.number(),
  hideCursor: z.boolean(),
  durationMs: z.number().nonnegative(),
  /** Pauses as wall-clock ms relative to the recording start (closed ranges only). */
  pausedRanges: z.array(z.object({ startMs: z.number(), endMs: z.number() })),
  /** Host-clock ns as a decimal string (may exceed 2^53). */
  firstFramePtsNs: z.string().nullable(),
  telemetryAligned: z.boolean(),
  interrupted: InterruptReason.optional(),
  interruptedDetail: z.string().optional(),
  stopReason: z.enum(["user", "maxLength"]).optional(),
  /** Renderer-streamed tracks whose final chunks never arrived (file kept as written). */
  incompleteTracks: z.array(Track).optional(),
  /**
   * Native backends: webcam start relative to the screen's first frame, in ms
   * (positive = the webcam starts later), measured from the first chunk's timing.
   */
  webcamOffsetMs: z.number().optional(),
  /**
   * Mic ranges muted mid-recording that the backend could not silence live, in
   * recorded (pause-free) ms. Post-process writes silence over them.
   */
  micMutedRanges: z.array(z.object({ startMs: z.number(), endMs: z.number() })).optional(),
});
export type RecordingMeta = z.infer<typeof RecordingMeta>;

export const ChunkBytes = z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]);

export const FinalizeResponse = z.object({
  recordingId: z.string(),
  dir: z.string(),
  video: MediaRef,
  mic: MediaRef.optional(),
  system: MediaRef.optional(),
  webcam: MediaRef.optional(),
  telemetry: TelemetryRef,
  meta: RecordingMeta,
  /** `<dir>/thumbnail.jpg` (640px wide) when post-process could render one. */
  thumbnailPath: z.string().optional(),
});
export type FinalizeResponse = z.infer<typeof FinalizeResponse>;

export const recordingContracts = {
  "recording:listSources": {
    name: "recording:listSources",
    request: z.void(),
    response: Sources.extend({ backend: BackendId }),
  },
  "recording:start": {
    name: "recording:start",
    request: StartRequest,
    response: z.object({
      sessionId: z.string(),
      backend: BackendId,
      backendReasons: z.array(z.string()),
    }),
  },
  "recording:pause": { name: "recording:pause", request: SessionRequest, response: Ok },
  "recording:resume": { name: "recording:resume", request: SessionRequest, response: Ok },
  "recording:stop": { name: "recording:stop", request: SessionRequest, response: Ok },
  "recording:discard": { name: "recording:discard", request: SessionRequest, response: Ok },
  "recording:setMicMuted": {
    name: "recording:setMicMuted",
    request: z.object({ sessionId: z.string(), muted: z.boolean() }),
    /**
     * `applied: false` when the backend cannot mute live; the muted range is then
     * silenced after stop (`meta.micMutedRanges`).
     */
    response: z.object({ ok: z.literal(true), applied: z.boolean() }),
  },
  "recording:writeChunk": {
    name: "recording:writeChunk",
    request: z.object({
      sessionId: z.string(),
      track: Track,
      /**
       * 0-based per track, strictly increasing without gaps. Main refuses a gap
       * (`CHUNK_GAP`) and treats a seq already on disk as an idempotent retry.
       */
      seq: z.number().int().nonnegative(),
      chunk: ChunkBytes,
      /**
       * Sent with the first screen chunk (Electron backend) or the first webcam
       * chunk next to a native helper (alignment, §5.6).
       */
      timing: ChunkTiming.optional(),
    }),
    response: Ok,
  },
  "recording:endTrack": {
    name: "recording:endTrack",
    request: z.object({
      sessionId: z.string(),
      track: Track,
      /** Chunks the renderer wrote successfully (= last seq + 1). */
      chunkCount: z.number().int().nonnegative(),
      mimeType: z.string().optional(),
    }),
    /** Rejects `CHUNK_COUNT_MISMATCH` (track still ended, data kept) when counts differ. */
    response: z.object({ ok: z.literal(true), chunkCount: z.number().int().nonnegative() }),
  },
  "recording:finalize": {
    name: "recording:finalize",
    request: SessionRequest,
    response: FinalizeResponse,
  },
} as const;

export type RecordingContracts = typeof recordingContracts;

export const RecordingEvent = z.discriminatedUnion("type", [
  z.object({
    sessionId: z.string(),
    type: z.literal("countdown"),
    remaining: z.number().int().nonnegative(),
  }),
  z.object({ sessionId: z.string(), type: z.literal("started"), backend: BackendId }),
  z.object({ sessionId: z.string(), type: z.literal("paused"), recordedMs: z.number() }),
  z.object({ sessionId: z.string(), type: z.literal("resumed"), recordedMs: z.number() }),
  z.object({
    sessionId: z.string(),
    type: z.literal("stats"),
    recordedMs: z.number(),
    fps: z.number(),
    droppedFrames: z.number(),
    fileBytes: z.number(),
    micRms: z.number().optional(),
  }),
  z.object({
    sessionId: z.string(),
    type: z.literal("stopped"),
    recordedMs: z.number(),
    reason: z.enum(["user", "maxLength"]),
  }),
  z.object({
    sessionId: z.string(),
    type: z.literal("interrupted"),
    reason: InterruptReason,
    detail: z.string().optional(),
    /** "Recording saved up to 00:42". */
    recordedMs: z.number(),
  }),
  z.object({ sessionId: z.string(), type: z.literal("diskLow"), freeBytes: z.number() }),
  z.object({ sessionId: z.string(), type: z.literal("deviceLost"), device: z.string() }),
  z.object({ sessionId: z.string(), type: z.literal("discarded") }),
  z.object({
    sessionId: z.string(),
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type RecordingEvent = z.infer<typeof RecordingEvent>;

/** Background VP9→H.264 transcode of a finalized recording's screen video (§5.2). */
export const TranscodeProgress = z.object({
  sessionId: z.string(),
  /** 0..1. */
  progress: z.number().min(0).max(1),
  done: z.boolean(),
  /**
   * H.264 file. Equals the finalized `video.path` when swapped in place; a
   * different path when the original had already moved (e.g. into a project).
   * `null` until done, and when the transcode failed (`error` set).
   */
  outputPath: z.string().nullable(),
  error: z.string().optional(),
});
export type TranscodeProgress = z.infer<typeof TranscodeProgress>;

export const recordingEvents = {
  "recording:event": { name: "recording:event", payload: RecordingEvent },
  "recording:transcodeProgress": {
    name: "recording:transcodeProgress",
    payload: TranscodeProgress,
  },
} as const;
