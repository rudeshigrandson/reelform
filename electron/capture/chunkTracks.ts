import type { Timers } from "./helperProcess";
import type { Track } from "./types";

/**
 * Ordered per-track chunk files streamed from the renderer (§5.2). Shared by
 * the Electron backend (every track) and the native helper backends (the
 * renderer-recorded webcam track). Each track is appended to one file, in
 * `seq` order, never buffering a whole recording in memory.
 *
 * Ordering contract (enforced here, not trusted from the renderer):
 * - `seq` is 0-based per track. A chunk is accepted only when `seq` equals the
 *   next expected value; a jump is refused with `CHUNK_GAP` and never reaches
 *   disk (appending past a lost WebM cluster corrupts the file).
 * - A `seq` already on disk is an idempotent no-op (a retried IPC call); one
 *   still being written is refused with `CHUNK_DUPLICATE`.
 * - A failed write rewinds the expected `seq` to the failed chunk, so the
 *   renderer may retry it; queued later chunks are refused with `CHUNK_GAP`.
 * - `end(track, chunkCount)` completes a track: later chunks are refused with
 *   `TRACK_ENDED`. `close(true)` waits (up to a grace period) for every opened
 *   track to be ended so the renderer's final flush is kept.
 */

export interface TrackWriter {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
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
  | "CHUNK_COUNT_MISMATCH"
  | "WRONG_TRACK";

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

export interface ChunkTracksOptions {
  /** File path for a track (created/truncated on its first chunk). */
  pathFor(track: Track): string;
  openWriter(path: string): Promise<TrackWriter>;
  /** A chunk failed to reach disk (the session decides whether that interrupts). */
  onWriteError(err: unknown, track: Track): void;
  /** Without timers `close(true)` never waits for unended tracks. */
  timers?: Timers | undefined;
  endTrackGraceMs?: number | undefined;
}

export interface ChunkTracksResult {
  paths: Partial<Record<Track, string>>;
  /** Opened tracks never ended before close (only reported when timers enforce completion). */
  incompleteTracks?: Track[] | undefined;
}

interface TrackState {
  writer: Promise<TrackWriter>;
  queue: Promise<void>;
  /** Next `seq` accepted into the queue. */
  nextSeq: number;
  /** Chunks on disk (contiguous from 0). */
  committed: number;
  ended: boolean;
}

export class ChunkTracks {
  private readonly tracks = new Map<Track, TrackState>();
  /** Tracks ended without ever writing a chunk (e.g. a silent webcam). */
  private readonly endedEmpty = new Set<Track>();
  private readonly paths: Partial<Record<Track, string>> = {};
  private readonly endWaiters = new Set<() => void>();
  private closedFlag = false;
  private result: Promise<ChunkTracksResult> | null = null;

  constructor(private readonly opts: ChunkTracksOptions) {}

  get closed(): boolean {
    return this.closedFlag;
  }

  /** Tracks that received at least one chunk. */
  get opened(): Track[] {
    return [...this.tracks.keys()];
  }

  private open(track: Track): TrackState {
    let state = this.tracks.get(track);
    if (!state) {
      const path = this.opts.pathFor(track);
      const writer = this.opts.openWriter(path).then((w) => {
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

  /**
   * Validate and queue one chunk. `onAccepted` runs synchronously once the
   * chunk is accepted for writing (before it reaches disk).
   */
  write(
    track: Track,
    chunk: Uint8Array,
    seq: number,
    onAccepted?: (() => void) | undefined,
  ): Promise<void> {
    if (this.closedFlag) return Promise.reject(new SessionClosedError());
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
    onAccepted?.();

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
          this.opts.onWriteError(err, track);
          throw err;
        }
        state.committed = seq + 1;
      });
    state.queue = next;
    return next;
  }

  async end(track: Track, chunkCount: number): Promise<{ chunkCount: number }> {
    const state = this.tracks.get(track);
    let written = 0;
    if (state) {
      await state.queue.catch(() => {});
      written = state.committed;
      state.ended = true;
    } else if (!this.closedFlag) {
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
  }

  private allEnded(): boolean {
    for (const s of this.tracks.values()) if (!s.ended) return false;
    return true;
  }

  /** Resolve once every opened track has ended, or after the grace period. */
  private waitForTracks(): Promise<void> {
    const timers = this.opts.timers;
    if (!timers || this.allEnded()) return Promise.resolve();
    const grace = this.opts.endTrackGraceMs ?? DEFAULT_END_TRACK_GRACE_MS;
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

  /**
   * Stop intake, flush queued chunks and close every writer. Idempotent.
   * `waitForTracks` keeps accepting chunks until every opened track ended
   * (or the grace period passed); `false` refuses new chunks immediately.
   */
  close(waitForTracks: boolean): Promise<ChunkTracksResult> {
    if (!waitForTracks) this.closedFlag = true;
    this.result ??= (async () => {
      if (waitForTracks) await this.waitForTracks();
      this.closedFlag = true;
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
      const res: ChunkTracksResult = { paths: { ...this.paths } };
      if (this.opts.timers && incomplete.length > 0) res.incompleteTracks = incomplete;
      return res;
    })();
    return this.result;
  }
}
