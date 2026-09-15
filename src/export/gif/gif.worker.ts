import { createGifWorkerHost } from "./workerHost";

/**
 * GIF encode worker entry (ENGINEERING_SPEC §2 "GIF quantize worker").
 * Construct with `new Worker(new URL("./gif.worker.ts", import.meta.url), { type: "module" })`.
 */

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;
const host = createGifWorkerHost((message, transfer) => scope.postMessage(message, transfer));
scope.onmessage = (event) => host.handle(event.data);
