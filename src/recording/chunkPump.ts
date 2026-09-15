import type { BlobLike } from "./media";
import type { ChunkTiming, TrackKind, WriteChunkRequest } from "./port";

/**
 * Streams MediaRecorder `dataavailable` blobs to disk in order (§5.2).
 *
 * Each blob is converted to an ArrayBuffer only when it reaches the head of the
 * queue and is released once written, so at most the unwritten backlog lives in
 * memory — never the whole file. Writes are strictly serial (each awaits the
 * previous one). After the first write error the pump stops writing and drops
 * later chunks; `flush()` rejects with that error.
 */

export interface ChunkPumpOptions {
  sessionId: string;
  track: TrackKind;
  write: (req: WriteChunkRequest) => Promise<void>;
  onError?: ((err: unknown) => void) | undefined;
  /** Read when chunk 0 is written; attached to it when defined (screen track alignment). */
  firstChunkTiming?: (() => ChunkTiming | undefined) | undefined;
}

export interface ChunkPump {
  /** Enqueue a blob; empty blobs are ignored and consume no sequence number. */
  push(blob: BlobLike): void;
  /** Resolves when every pushed chunk is written; rejects with the first write error. */
  flush(): Promise<void>;
  /** Stop writing: queued chunks that haven't started are dropped. */
  abort(): void;
  /** Chunks pushed but not yet written. */
  readonly pending: number;
  /** Chunks successfully written (= next seq). */
  readonly written: number;
  readonly error: unknown;
}

export function createChunkPump(opts: ChunkPumpOptions): ChunkPump {
  let nextSeq = 0;
  let written = 0;
  let pending = 0;
  let aborted = false;
  let failed = false;
  let error: unknown;
  let tail: Promise<void> = Promise.resolve();

  const push = (blob: BlobLike): void => {
    if (aborted || failed || blob.size <= 0) return;
    const seq = nextSeq++;
    pending++;
    tail = tail.then(async () => {
      try {
        if (aborted || failed) return;
        const chunk = await blob.arrayBuffer();
        if (aborted || failed) return;
        const timing = seq === 0 ? opts.firstChunkTiming?.() : undefined;
        await opts.write(
          timing
            ? { sessionId: opts.sessionId, track: opts.track, seq, chunk, timing }
            : { sessionId: opts.sessionId, track: opts.track, seq, chunk },
        );
        written++;
      } catch (err) {
        if (!failed) {
          failed = true;
          error = err;
          opts.onError?.(err);
        }
      } finally {
        pending--;
      }
    });
  };

  return {
    push,
    flush: async () => {
      await tail;
      if (failed) throw error;
    },
    abort: () => {
      aborted = true;
    },
    get pending() {
      return pending;
    },
    get written() {
      return written;
    },
    get error() {
      return error;
    },
  };
}
