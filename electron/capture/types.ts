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

/** `recording:start` request body (§3). Region is display-local pixels. */
export const StartRequest = z.object({
  source: SourceRef,
  region: Rect.optional(),
  audio: z.object({ mic: z.string().optional(), system: z.boolean() }),
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
}

/** Timing sent by the renderer with the first screen chunk (Electron backend, §5.6). */
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
  /** Electron backend only: the renderer streams encoded chunks to main. */
  writeChunk?:
    | ((track: Track, chunk: Uint8Array, timing?: ChunkTiming | undefined) => Promise<void>)
    | undefined;
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
