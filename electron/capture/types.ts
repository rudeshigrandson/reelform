import { z } from "zod";

/**
 * Capture backend abstraction (ENGINEERING_SPEC §5.1).
 *
 * Pure types + zod schemas only — no node / electron imports — so the recording
 * contracts (which the renderer sees through `@contracts`) can reuse them.
 */

export const BackendId = z.enum(["sck", "wgc", "dxgi", "electron"]);
export type BackendId = z.infer<typeof BackendId>;

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Rect = z.infer<typeof Rect>;

export const DisplayInfo = z.object({
  id: z.string(),
  name: z.string(),
  /** Global coordinates, in the same space the input hook reports. */
  bounds: Rect,
  scaleFactor: z.number().positive(),
  /** data: URL thumbnail. */
  thumbnail: z.string().optional(),
  /**
   * Chromium desktop-capture id (`screen:<n>:0`) for `chromeMediaSourceId`.
   * Only the Electron backend reports it; the renderer needs it to capture a display.
   */
  mediaSourceId: z.string().optional(),
});
export type DisplayInfo = z.infer<typeof DisplayInfo>;

export const WindowInfo = z.object({
  id: z.string(),
  title: z.string(),
  appName: z.string().optional(),
  bounds: Rect.optional(),
  displayId: z.string().optional(),
  thumbnail: z.string().optional(),
  appIcon: z.string().optional(),
});
export type WindowInfo = z.infer<typeof WindowInfo>;

export const Sources = z.object({
  displays: z.array(DisplayInfo),
  windows: z.array(WindowInfo),
});
export type Sources = z.infer<typeof Sources>;

export const SourceRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("display"), id: z.string() }),
  z.object({ kind: z.literal("window"), id: z.string() }),
]);
export type SourceRef = z.infer<typeof SourceRef>;

export const Track = z.enum(["screen", "mic", "system", "webcam"]);
export type Track = z.infer<typeof Track>;

/**
 * `recording:start` request body (§3). `region` is display-local, in the same
 * units as `DisplayInfo.bounds` (DIP / points); multiply by the display's
 * `scaleFactor` for device pixels.
 */
export const StartRequest = z.object({
  source: SourceRef,
  region: Rect.optional(),
  audio: z.object({
    mic: z.string().optional(),
    /**
     * `MediaDeviceInfo.label` of the chosen mic. Chromium deviceIds are hashed and
     * never match a native device, so the helpers resolve the mic by label (§5.3/§5.4).
     */
    micLabel: z.string().optional(),
    /** Windows `IMMDevice::GetId`, when known (exact match before the label). */
    micEndpointId: z.string().optional(),
    system: z.boolean(),
  }),
  webcam: z.string().optional(),
  fps: z.union([z.literal(30), z.literal(60)]),
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]),
  hideCursor: z.boolean(),
});
export type StartRequest = z.infer<typeof StartRequest>;

/** What a backend receives: the user request + where to write files. */
export interface StartOptions extends StartRequest {
  sessionId: string;
  /** Absolute directory the backend writes its track files into. */
  outDir: string;
}

export type InterruptReason =
  | "displayDisconnected"
  | "helperCrash"
  | "diskLow"
  | "deviceLost"
  | "other";

export interface CaptureStats {
  fps: number;
  droppedFrames: number;
  fileBytes: number;
  micRms?: number | undefined;
}

/** Backend → session controller events. */
export type CaptureEvent =
  | { type: "started"; firstFramePtsNs: bigint }
  | ({ type: "stats" } & CaptureStats)
  | { type: "interrupted"; reason: InterruptReason; detail?: string | undefined }
  | { type: "deviceLost"; device: string };

export type EventSink = (event: CaptureEvent) => void;

/** Final file set a backend produced. Paths are absolute; missing tracks omitted. */
export interface StopResult {
  /** Backend-measured duration (paused time excluded) when known. */
  durationMs: number | null;
  paths: Partial<Record<Track, string>>;
  /** Renderer-streamed tracks never ended (`recording:endTrack`) before close. */
  incompleteTracks?: Track[] | undefined;
  /**
   * Native backends: start of a renderer-recorded track (webcam) relative to the
   * helper's first frame, in ms (positive = the track starts later).
   */
  trackOffsetsMs?: Partial<Record<Track, number>> | undefined;
}

/**
 * Timing sent by the renderer with the first chunk of the track it aligns on:
 * the screen track (Electron backend) or the webcam track recorded next to a
 * native helper (§5.6).
 */
export const ChunkTiming = z.object({
  /** `performance.timeOrigin` in the renderer (epoch ms). */
  timeOriginMs: z.number(),
  /** `performance.now()` at the MediaRecorder `start` event. */
  recorderStartMs: z.number(),
  /** `performance.now()` at the first `dataavailable`. */
  firstDataMs: z.number().optional(),
  timesliceMs: z.number().positive().optional(),
});
export type ChunkTiming = z.infer<typeof ChunkTiming>;

export interface Session {
  readonly backend: BackendId;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Stop capturing. Writers may still be flushing until `close`. */
  stop(): Promise<void>;
  /** Stop and delete everything this session wrote. */
  discard(): Promise<void>;
  /** Flush + close writers and report the files on disk. Idempotent. */
  close(): Promise<StopResult>;
  /**
   * Mute / unmute the microphone mid-recording (§5.7). Resolves `true` when the
   * mute is applied live, `false` when the backend cannot (the controller then
   * silences the muted ranges after stop).
   */
  setMicMuted?: ((muted: boolean) => Promise<boolean>) | undefined;
  /**
   * The renderer streams encoded chunks to main: every track on the Electron
   * backend, the webcam track on native backends. `seq` is 0-based per track and
   * must arrive without gaps (see `chunkTracks.ts`).
   */
  writeChunk?:
    | ((
        track: Track,
        chunk: Uint8Array,
        seq: number,
        timing?: ChunkTiming | undefined,
      ) => Promise<void>)
    | undefined;
  /**
   * The renderer wrote its last chunk for `track`.
   * Resolves with the chunk count on disk; rejects `CHUNK_COUNT_MISMATCH` (after
   * still ending the track) when it differs from `chunkCount`.
   */
  endTrack?: ((track: Track, chunkCount: number) => Promise<{ chunkCount: number }>) | undefined;
}

export interface Availability {
  ok: boolean;
  reason?: string | undefined;
}

export interface CaptureBackend {
  readonly id: BackendId;
  isAvailable(): Promise<Availability>;
  listSources(): Promise<Sources>;
  start(opts: StartOptions, sink: EventSink): Promise<Session>;
}
