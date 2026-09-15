import type { GifWorkerLike } from "../../export/gif/client";

/**
 * Vite module-worker factory for the GIF encoder (`src/export/gif/gif.worker.ts`).
 * Vite bundles the `new URL(..., import.meta.url)` form into a worker chunk.
 */
export function createGifWorker(): GifWorkerLike {
  const worker = new Worker(new URL("../../export/gif/gif.worker.ts", import.meta.url), {
    type: "module",
    name: "reelform-gif",
  });
  // A DOM Worker satisfies GifWorkerLike at runtime; its handler types are MessageEvent/ErrorEvent.
  return worker as unknown as GifWorkerLike;
}
