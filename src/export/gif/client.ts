import type {
  GifDoneMessage,
  GifProgressMessage,
  GifWorkerRequest,
  GifWorkerResponse,
} from "./protocol";
import type { GifEncoderOptions, RgbaFrame } from "./types";

/**
 * Main-thread client for the GIF worker. The Worker is created through an
 * injected factory so tests (and non-Vite hosts) can supply their own.
 *
 * `addFrame` resolves once the worker reports progress for that frame and every
 * chunk emitted so far has been handled by `onChunk`, which gives the exporter
 * natural encode + write backpressure (await each frame). Chunks are
 * delivered to `onChunk` strictly in order; `finish` resolves after the last
 * chunk handler settled. Any worker error rejects all pending and later calls.
 *
 * NOTE: frame buffers are transferred — the caller's `ImageData` is detached
 * afterwards (views onto a larger buffer are copied instead).
 */

export interface GifWorkerLike {
  postMessage(message: GifWorkerRequest, transfer: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string | undefined }) => void) | null;
  terminate(): void;
}

export interface GifEncoderClientDeps {
  createWorker: () => GifWorkerLike;
  onChunk: (bytes: Uint8Array) => void | Promise<void>;
  onProgress?: ((progress: GifProgressMessage) => void) | undefined;
}

export interface GifEncoderClient {
  init(options: GifEncoderOptions): void;
  addSample(frame: RgbaFrame): void;
  addFrame(frame: RgbaFrame): Promise<GifProgressMessage>;
  finish(): Promise<GifDoneMessage>;
  cancel(): void;
}

interface Deferred<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

export function createGifEncoderClient(deps: GifEncoderClientDeps): GifEncoderClient {
  let worker: GifWorkerLike | null = null;
  let nextIndex = 0;
  let failure: Error | null = null;
  let chunkChain: Promise<void> = Promise.resolve();
  const frameWaiters = new Map<number, Deferred<GifProgressMessage>>();
  let finishWaiter: Deferred<GifDoneMessage> | null = null;

  const rejectAll = (err: Error): void => {
    if (failure) return;
    failure = err;
    for (const d of frameWaiters.values()) d.reject(err);
    frameWaiters.clear();
    finishWaiter?.reject(err);
    finishWaiter = null;
    worker?.terminate();
    worker = null;
  };

  const onMessage = (data: GifWorkerResponse): void => {
    switch (data.type) {
      case "chunk": {
        const bytes = new Uint8Array(data.bytes);
        chunkChain = chunkChain.then(() => deps.onChunk(bytes));
        chunkChain.catch((e: unknown) => rejectAll(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      case "progress": {
        deps.onProgress?.(data);
        const d = frameWaiters.get(data.frameIndex);
        // Resolve only after this frame's chunks reached the sink (write backpressure).
        chunkChain.then(
          () => {
            if (frameWaiters.get(data.frameIndex) !== d) return;
            frameWaiters.delete(data.frameIndex);
            d?.resolve(data);
          },
          () => undefined, // rejectAll already rejected the waiter
        );
        return;
      }
      case "done": {
        const waiter = finishWaiter;
        finishWaiter = null;
        chunkChain.then(
          () => {
            waiter?.resolve(data);
            worker?.terminate();
            worker = null;
          },
          (e: unknown) =>
            waiter?.reject(failure ?? (e instanceof Error ? e : new Error(String(e)))),
        );
        return;
      }
      case "error":
        rejectAll(new Error(data.message));
        return;
    }
  };

  const requireWorker = (): GifWorkerLike => {
    if (failure) throw failure;
    if (!worker) throw new Error("GIF encoder client not initialised");
    return worker;
  };

  const transferable = (frame: RgbaFrame): ArrayBuffer => {
    const { data } = frame;
    const n = frame.width * frame.height * 4;
    if (data.length < n) throw new RangeError("frame data too short");
    // Only transfer a buffer the frame owns exactly; never detach a larger shared backing store.
    if (
      data.byteOffset === 0 &&
      data.byteLength === n &&
      data.buffer instanceof ArrayBuffer &&
      data.buffer.byteLength === n
    )
      return data.buffer;
    return new Uint8Array(data.buffer, data.byteOffset, n).slice().buffer;
  };

  return {
    init(options) {
      if (worker || failure) throw new Error("GIF encoder client already initialised");
      const w = deps.createWorker();
      worker = w;
      w.onmessage = (ev) => onMessage(ev.data as GifWorkerResponse);
      w.onerror = (ev) => rejectAll(new Error(ev.message ?? "GIF worker crashed"));
      w.postMessage({ type: "init", options }, []);
    },
    addSample(frame) {
      const w = requireWorker();
      const buffer = transferable(frame);
      w.postMessage({ type: "sample", width: frame.width, height: frame.height, buffer }, [buffer]);
    },
    addFrame(frame) {
      try {
        const w = requireWorker();
        const index = nextIndex++;
        const buffer = transferable(frame);
        const promise = new Promise<GifProgressMessage>((resolve, reject) =>
          frameWaiters.set(index, { resolve, reject }),
        );
        w.postMessage(
          { type: "addFrame", index, width: frame.width, height: frame.height, buffer },
          [buffer],
        );
        return promise;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    finish() {
      try {
        const w = requireWorker();
        const promise = new Promise<GifDoneMessage>((resolve, reject) => {
          finishWaiter = { resolve, reject };
        });
        w.postMessage({ type: "finish" }, []);
        return promise;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    cancel() {
      if (worker) worker.postMessage({ type: "cancel" }, []);
      rejectAll(new Error("GIF export cancelled"));
    },
  };
}
