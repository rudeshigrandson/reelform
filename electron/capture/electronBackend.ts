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
 * `<outDir>/<track>.webm`, in `seq` order per track, never buffering a whole
 * recording in memory. Pause/resume/stop are driven by renderer events, so the
 * session methods only track state.
 *
 * Ordering contract (enforced here, not trusted from the renderer):
 * - `seq` is 0-based per track. A chunk is accepted only when `seq` equals the
 *   next expected value; a jump is refused with `CHUNK_GAP` and never reaches
 *   disk (appending past a lost WebM cluster corrupts the file).
 * - A `seq` already on disk is an idempotent no-op (a retried IPC call); one
 *   still being written is refused with `CHUNK_DUPLICATE`.
 * - A failed write rewinds the expected `seq` to the failed chunk, so the
 *   renderer may retry it; queued later chunks are refused with `CHUNK_GAP`.
 * - `endTrack(track, chunkCount)` completes a track: later chunks are refused
 *   with `TRACK_ENDED`. `close()` waits (up to a grace period) for every opened
 *   track to be ended so the renderer's final flush is kept.
 */

export interface TrackWriter {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

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

export const DEFAULT_END_TRACK_GRACE_MS = 10_000;

export class SessionClosedError extends Error {
  readonly code = "SESSION_CLOSED";
  constructor() {
    super("session no longer accepts chunks");
  }
}

export type ChunkErrorCode =
  | "CHUNK_GAP"
  | "CHUNK_DUPLICATE"
  | "CHUNK_SEQ_INVALID"
  | "TRACK_ENDED"
  | "CHUNK_COUNT_MISMATCH";

export class ChunkError extends Error {
  constructor(
    readonly code: ChunkErrorCode,
    message: string,
    readonly details?: { track: Track; expected: number; received: number } | undefined,
  ) {
    super(message);
    this.name = "ChunkError";
  }
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

interface TrackState {
  writer: Promise<TrackWriter>;
  queue: Promise<void>;
  /** Next `seq` accepted into the queue. */
  nextSeq: number;
  /** Chunks on disk (contiguous from 0). */
  committed: number;
  ended: boolean;
}

class ElectronSession implements Session {
  readonly backend = "electron" as const;
  private readonly tracks = new Map<Track, TrackState>();
  /** Tracks ended without ever writing a chunk (e.g. a silent webcam). */
  private readonly endedEmpty = new Set<Track>();
  private readonly paths: Partial<Record<Track, string>> = {};
  private readonly endWaiters = new Set<() => void>();
  private started = false;
  private closed = false;
  private result: Promise<StopResult> | null = null;

  constructor(
    private readonly opts: StartOptions,
    private readonly sink: EventSink,
    private readonly deps: ElectronBackendDeps,
  ) {}

  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  /** The renderer still flushes final chunks after stop; `close` ends intake. */
  async stop(): Promise<void> {}

  private open(track: Track): TrackState {
    let state = this.tracks.get(track);
    if (!state) {
      const path = this.deps.join(this.opts.outDir, `${track}.webm`);
      const writer = this.deps.openWriter(path).then((w) => {
        this.paths[track] = path;
        return w;
      });
      // Surface open failures on the first write instead of as unhandled rejections.
      writer.catch(() => {});
      state = { writer, queue: Promise.resolve(), nextSeq: 0, committed: 0, ended: false };
      this.tracks.set(track, state);
    }
    return state;
  }

  writeChunk = (
    track: Track,
    chunk: Uint8Array,
    seq: number,
    timing?: ChunkTiming | undefined,
  ): Promise<void> => {
    if (this.closed) return Promise.reject(new SessionClosedError());
    if (!Number.isSafeInteger(seq) || seq < 0) {
      return Promise.reject(
        new ChunkError("CHUNK_SEQ_INVALID", `invalid chunk seq ${String(seq)} for ${track}`),
      );
    }
    if (this.endedEmpty.has(track) || this.tracks.get(track)?.ended) {
      return Promise.reject(new ChunkError("TRACK_ENDED", `track ${track} already ended`));
    }
    const state = this.open(track);
    if (seq < state.committed) return Promise.resolve();
    if (seq < state.nextSeq) {
      return Promise.reject(
        new ChunkError("CHUNK_DUPLICATE", `chunk ${seq} of ${track} is already being written`, {
          track,
          expected: state.nextSeq,
          received: seq,
        }),
      );
    }
    if (seq > state.nextSeq) {
      return Promise.reject(
        new ChunkError("CHUNK_GAP", `chunk ${seq} of ${track} arrived before ${state.nextSeq}`, {
          track,
          expected: state.nextSeq,
          received: seq,
        }),
      );
    }
    state.nextSeq = seq + 1;

    if (timing && track === "screen" && !this.started && seq === 0) {
      this.started = true;
      this.sink({
        type: "started",
        firstFramePtsNs: electronFirstFrameEpochNs(timing, this.opts.fps),
      });
    }

    const next = state.queue
      .catch(() => {})
      .then(async () => {
        // An earlier chunk failed: writing this one would leave a hole on disk.
        if (seq !== state.committed) {
          throw new ChunkError(
            "CHUNK_GAP",
            `chunk ${seq} of ${track} follows a failed chunk ${state.committed}`,
            { track, expected: state.committed, received: seq },
          );
        }
        try {
          await (await state.writer).write(chunk);
        } catch (err) {
          if (state.nextSeq > seq) state.nextSeq = seq;
          this.sink({
            type: "interrupted",
            reason: isNoSpace(err) ? "diskLow" : "other",
            detail: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        state.committed = seq + 1;
      });
    state.queue = next;
    return next;
  };

  endTrack = async (track: Track, chunkCount: number): Promise<{ chunkCount: number }> => {
    const state = this.tracks.get(track);
    let written = 0;
    if (state) {
      await state.queue.catch(() => {});
      written = state.committed;
      state.ended = true;
    } else if (!this.closed) {
      this.endedEmpty.add(track);
    }
    for (const w of [...this.endWaiters]) w();
    if (chunkCount !== written) {
      throw new ChunkError(
        "CHUNK_COUNT_MISMATCH",
        `renderer wrote ${chunkCount} chunks of ${track} but ${written} reached disk`,
        { track, expected: chunkCount, received: written },
      );
    }
    return { chunkCount: written };
  };

  private allEnded(): boolean {
    for (const s of this.tracks.values()) if (!s.ended) return false;
    return true;
  }

  /** Resolve once every opened track has ended, or after the grace period. */
  private waitForTracks(): Promise<void> {
    const timers = this.deps.timers;
    if (!timers || this.allEnded()) return Promise.resolve();
    const grace = this.deps.endTrackGraceMs ?? DEFAULT_END_TRACK_GRACE_MS;
    return new Promise<void>((resolve) => {
      let handle: unknown = null;
      const done = (): void => {
        this.endWaiters.delete(check);
        if (handle !== null) timers.clearTimeout(handle);
        resolve();
      };
      const check = (): void => {
        if (this.allEnded()) done();
      };
      this.endWaiters.add(check);
      handle = timers.setTimeout(done, grace);
    });
  }

  async discard(): Promise<void> {
    await this.finish(false);
  }

  close(): Promise<StopResult> {
    return this.finish(true);
  }

  private finish(waitForTracks: boolean): Promise<StopResult> {
    if (!waitForTracks) this.closed = true;
    this.result ??= (async () => {
      if (waitForTracks) await this.waitForTracks();
      this.closed = true;
      await Promise.all([...this.tracks.values()].map((s) => s.queue.catch(() => {})));
      await Promise.all(
        [...this.tracks.values()].map(async (s) => {
          try {
            await (await s.writer).close();
          } catch {
            // A writer that failed to open/close has nothing more to flush.
          }
        }),
      );
      const incomplete = [...this.tracks.entries()].filter(([, s]) => !s.ended).map(([t]) => t);
      const res: StopResult = { durationMs: null, paths: { ...this.paths } };
      if (this.deps.timers && incomplete.length > 0) res.incompleteTracks = incomplete;
      return res;
    })();
    return this.result;
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
