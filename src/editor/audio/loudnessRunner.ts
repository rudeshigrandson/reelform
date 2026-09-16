import { integratedLoudness } from "./loudness";
import type { LoudnessTrack } from "./loudnessStore";

/**
 * Runs the EBU R128 integrated-loudness measurement off the main thread
 * (ENGINEERING_SPEC §9.5 "measure … via a worker on first enable"). Channels
 * are copied before transfer so cached decoded buffers stay attached. Falls
 * back to measuring inline when workers are unavailable (tests, non-browser hosts).
 */

/** Decoded PCM, one Float32Array per channel (same shape as the inspector host's). */
export interface LoudnessInput {
  channels: readonly Float32Array[];
  sampleRate: number;
}

export interface LoudnessWorkerRequest {
  channels: Float32Array[];
  sampleRate: number;
}

export type LoudnessWorkerResponse = { ok: true; lufs: number } | { ok: false; message: string };

/** Minimal Worker surface so tests can inject a fake. */
export interface LoudnessWorkerLike {
  postMessage(message: LoudnessWorkerRequest, transfer: Transferable[]): void;
  onmessage: ((event: { data: LoudnessWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

export type LoudnessWorkerFactory = () => LoudnessWorkerLike | null;

export function defaultLoudnessWorkerFactory(): LoudnessWorkerLike | null {
  if (typeof Worker === "undefined") return null;
  try {
    const worker = new Worker(new URL("./loudness.worker.ts", import.meta.url), {
      type: "module",
      name: "reelform-loudness",
    });
    // A DOM Worker satisfies LoudnessWorkerLike at runtime; its handler types are MessageEvent/ErrorEvent.
    return worker as unknown as LoudnessWorkerLike;
  } catch {
    return null;
  }
}

/** Worker-side body (also the inline fallback). */
export function handleLoudnessRequest(req: LoudnessWorkerRequest): LoudnessWorkerResponse {
  try {
    return { ok: true, lufs: integratedLoudness(req.channels, req.sampleRate) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Integrated loudness (LUFS) of a decoded track; `-Infinity` for silence. */
export function measureLoudness(
  decoded: LoudnessInput,
  createWorker: LoudnessWorkerFactory = defaultLoudnessWorkerFactory,
): Promise<number> {
  if (decoded.channels.length === 0 || !(decoded.sampleRate > 0)) {
    return Promise.resolve(Number.NEGATIVE_INFINITY);
  }
  const worker = createWorker();
  if (!worker) {
    const res = handleLoudnessRequest({
      channels: [...decoded.channels],
      sampleRate: decoded.sampleRate,
    });
    return res.ok ? Promise.resolve(res.lufs) : Promise.reject(new Error(res.message));
  }
  const req: LoudnessWorkerRequest = {
    channels: decoded.channels.map((c) => c.slice()),
    sampleRate: decoded.sampleRate,
  };
  return new Promise<number>((resolve, reject) => {
    const done = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    worker.onmessage = (event) => {
      done();
      if (event.data.ok) resolve(event.data.lufs);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || "Loudness worker failed."));
    };
    worker.postMessage(
      req,
      req.channels.map((c) => c.buffer),
    );
  });
}

export interface NormalizeTrackState {
  normalize: boolean;
}

/**
 * Tracks whose loudness should be measured now: Normalize is on, the track has
 * a source URL, and that URL hasn't been measured (or requested) yet.
 */
export function tracksToMeasure(
  tracks: Readonly<Record<LoudnessTrack, NormalizeTrackState>>,
  urls: Readonly<Partial<Record<LoudnessTrack, string | null>>>,
  measuredUrls: Readonly<Partial<Record<LoudnessTrack, string>>>,
): LoudnessTrack[] {
  return (["mic", "system"] as const).filter((kind) => {
    const url = urls[kind];
    return tracks[kind].normalize && Boolean(url) && measuredUrls[kind] !== url;
  });
}
