import {
  ChunkError,
  type ChunkErrorCode,
  ChunkTracks,
  DEFAULT_END_TRACK_GRACE_MS,
  SessionClosedError,
  type TrackWriter,
} from "./chunkTracks";
import type { Timers } from "./helperProcess";
import type {
  Availability,
  CaptureBackend,
  ChunkTiming,
  EventSink,
  Session,
  Sources,
  StartOptions,
  StopResult,
  Track,
} from "./types";

/**
 * Electron backend, main-process side (§5.2). The MediaRecorders run in the
 * renderer; main only appends the streamed chunks (`recording:writeChunk`) to
 * `<outDir>/<track>.webm` through {@link ChunkTracks}, which enforces the
 * seq / gap / endTrack ordering contract. Pause/resume/stop are driven by
 * renderer events, so the session methods only track state.
 */

export { ChunkError, DEFAULT_END_TRACK_GRACE_MS, SessionClosedError };
export type { ChunkErrorCode, TrackWriter };

export interface ElectronBackendDeps {
  /** desktopCapturer + screen → sources with thumbnails. */
  getSources(): Promise<Sources>;
  /** Open (create/truncate) a file for sequential appends. */
  openWriter(path: string): Promise<TrackWriter>;
  join(...parts: string[]): string;
  isAvailable?: (() => Promise<Availability>) | undefined;
  /**
   * When given, `close()` waits up to `endTrackGraceMs` for the renderer to end
   * every opened track. Without timers `close()` never waits.
   */
  timers?: Timers | undefined;
  endTrackGraceMs?: number | undefined;
}

/**
 * First video frame time on the epoch-ns clock (§5.6): `performance.timeOrigin +
 * MediaRecorder start`, corrected by the first `dataavailable` when the
 * recorder visibly lagged by more than one frame. Accepts ±1 frame.
 */
export function electronFirstFrameEpochNs(timing: ChunkTiming, fps: number): bigint {
  const startMs = timing.timeOriginMs + timing.recorderStartMs;
  let ms = startMs;
  if (timing.firstDataMs !== undefined && timing.timesliceMs !== undefined) {
    const estimate = timing.timeOriginMs + timing.firstDataMs - timing.timesliceMs;
    const frameMs = 1000 / (fps > 0 ? fps : 60);
    if (estimate > startMs + frameMs) ms = estimate;
  }
  // µs precision; epoch ns exceed 2^53 so scale in bigint.
  return BigInt(Math.round(ms * 1000)) * 1000n;
}

const isNoSpace = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOSPC";

class ElectronSession implements Session {
  readonly backend = "electron" as const;
  private readonly chunks: ChunkTracks;
  private started = false;

  constructor(
    private readonly opts: StartOptions,
    private readonly sink: EventSink,
    deps: ElectronBackendDeps,
  ) {
    this.chunks = new ChunkTracks({
      pathFor: (track) => deps.join(opts.outDir, `${track}.webm`),
      openWriter: (path) => deps.openWriter(path),
      onWriteError: (err) =>
        this.sink({
          type: "interrupted",
          reason: isNoSpace(err) ? "diskLow" : "other",
          detail: err instanceof Error ? err.message : String(err),
        }),
      timers: deps.timers,
      endTrackGraceMs: deps.endTrackGraceMs,
    });
  }

  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  /** The renderer still flushes final chunks after stop; `close` ends intake. */
  async stop(): Promise<void> {}
  /** The renderer disables its mic track itself (§5.7); nothing to do in main. */
  async setMicMuted(): Promise<boolean> {
    return true;
  }

  writeChunk = (
    track: Track,
    chunk: Uint8Array,
    seq: number,
    timing?: ChunkTiming | undefined,
  ): Promise<void> =>
    this.chunks.write(track, chunk, seq, () => {
      if (timing && track === "screen" && !this.started && seq === 0) {
        this.started = true;
        this.sink({
          type: "started",
          firstFramePtsNs: electronFirstFrameEpochNs(timing, this.opts.fps),
        });
      }
    });

  endTrack = (track: Track, chunkCount: number): Promise<{ chunkCount: number }> =>
    this.chunks.end(track, chunkCount);

  async discard(): Promise<void> {
    await this.chunks.close(false);
  }

  async close(): Promise<StopResult> {
    const res = await this.chunks.close(true);
    const out: StopResult = { durationMs: null, paths: res.paths };
    if (res.incompleteTracks) out.incompleteTracks = res.incompleteTracks;
    return out;
  }
}

export function createElectronBackend(deps: ElectronBackendDeps): CaptureBackend {
  return {
    id: "electron",
    isAvailable: () => deps.isAvailable?.() ?? Promise.resolve({ ok: true }),
    listSources: () => deps.getSources(),
    start: async (opts, sink) => new ElectronSession(opts, sink, deps),
  };
}
