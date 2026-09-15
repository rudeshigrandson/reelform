import {
  SYNC_WINDOW_MS,
  type SyncOptions,
  type SyncResult,
  estimateSyncOffsetMs,
} from "./webcamSync";
import { ti } from "../i18n";

/**
 * Runs the auto-sync correlation off the main thread (SPEC §9.4). Only the
 * samples the search can read are copied and transferred, so the cached decoded
 * buffers stay attached. Falls back to running inline when workers are
 * unavailable (tests, non-browser hosts).
 */

export interface SyncTrack {
  samples: Float32Array;
  sampleRate: number;
}

export interface SyncWorkerRequest {
  mic: SyncTrack;
  webcam: SyncTrack;
  opts: SyncOptions;
}

export type SyncWorkerResponse =
  | { ok: true; result: SyncResult | null }
  | { ok: false; message: string };

/** Minimal Worker surface so tests can inject a fake. */
export interface SyncWorkerLike {
  postMessage(message: SyncWorkerRequest, transfer: Transferable[]): void;
  onmessage: ((event: { data: SyncWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

export type SyncWorkerFactory = () => SyncWorkerLike | null;

const DEFAULT_MAX_LAG_MS = 5000;

export function defaultSyncWorkerFactory(): SyncWorkerLike | null {
  if (typeof Worker === "undefined") return null;
  try {
    const worker = new Worker(new URL("./webcamSync.worker.ts", import.meta.url), {
      type: "module",
      name: "reelform-webcam-sync",
    });
    // A DOM Worker satisfies SyncWorkerLike at runtime; its handler types are MessageEvent/ErrorEvent.
    return worker as unknown as SyncWorkerLike;
  } catch {
    return null;
  }
}

/** Copy of the prefix the correlation reads (window + max lag). */
export function syncPrefix(track: SyncTrack, ms: number): SyncTrack {
  const n = Math.min(track.samples.length, Math.ceil((track.sampleRate * ms) / 1000));
  return { samples: track.samples.slice(0, n), sampleRate: track.sampleRate };
}

export function estimateSyncOffsetOffThread(
  mic: SyncTrack,
  webcam: SyncTrack,
  opts: SyncOptions = {},
  createWorker: SyncWorkerFactory = defaultSyncWorkerFactory,
): Promise<SyncResult | null> {
  const windowMs = opts.windowMs ?? SYNC_WINDOW_MS;
  const maxLagMs = opts.maxLagMs ?? DEFAULT_MAX_LAG_MS;
  const worker = createWorker();
  if (!worker) {
    try {
      return Promise.resolve(estimateSyncOffsetMs(mic, webcam, opts));
    } catch (err) {
      return Promise.reject(err);
    }
  }
  const req: SyncWorkerRequest = {
    mic: syncPrefix(mic, windowMs),
    webcam: syncPrefix(webcam, windowMs + maxLagMs),
    opts,
  };
  return new Promise<SyncResult | null>((resolve, reject) => {
    const done = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    worker.onmessage = (event) => {
      done();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || ti("inspector.webcam.sync.workerFailed")));
    };
    worker.postMessage(req, [req.mic.samples.buffer, req.webcam.samples.buffer]);
  });
}
