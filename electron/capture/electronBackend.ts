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
 * `<outDir>/<track>.webm`, in arrival order per track, never buffering a whole
 * recording in memory. Pause/resume/stop are driven by renderer events, so the
 * session methods only track state.
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
}

export class SessionClosedError extends Error {
  readonly code = "SESSION_CLOSED";
  constructor() {
    super("session no longer accepts chunks");
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

class ElectronSession implements Session {
  readonly backend = "electron" as const;
  private readonly writers = new Map<Track, Promise<TrackWriter>>();
  private readonly queues = new Map<Track, Promise<void>>();
  private readonly paths: Partial<Record<Track, string>> = {};
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

  writeChunk = (
    track: Track,
    chunk: Uint8Array,
    timing?: ChunkTiming | undefined,
  ): Promise<void> => {
    if (this.closed) return Promise.reject(new SessionClosedError());
    if (timing && track === "screen" && !this.started) {
      this.started = true;
      this.sink({
        type: "started",
        firstFramePtsNs: electronFirstFrameEpochNs(timing, this.opts.fps),
      });
    }
    let writer = this.writers.get(track);
    if (!writer) {
      const path = this.deps.join(this.opts.outDir, `${track}.webm`);
      writer = this.deps.openWriter(path).then((w) => {
        this.paths[track] = path;
        return w;
      });
      this.writers.set(track, writer);
    }
    const w = writer;
    const prev = this.queues.get(track) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => (await w).write(chunk))
      .catch((err: unknown) => {
        this.sink({
          type: "interrupted",
          reason: isNoSpace(err) ? "diskLow" : "other",
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
    this.queues.set(track, next);
    return next;
  };

  async discard(): Promise<void> {
    await this.close();
  }

  close(): Promise<StopResult> {
    this.closed = true;
    this.result ??= (async () => {
      await Promise.all([...this.queues.values()].map((q) => q.catch(() => {})));
      await Promise.all(
        [...this.writers.values()].map(async (wp) => {
          try {
            await (await wp).close();
          } catch {
            // A writer that failed to open/close has nothing more to flush.
          }
        }),
      );
      return { durationMs: null, paths: { ...this.paths } };
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
