import { type SyncOptions, estimateSyncOffsetMs } from "./webcamSync";
import type { SyncWorkerRequest, SyncWorkerResponse } from "./webcamSyncRunner";

/**
 * Webcam auto-sync worker (SPEC §9.4 "in a worker"). Construct with
 * `new Worker(new URL("./webcamSync.worker.ts", import.meta.url), { type: "module" })`.
 */

interface WorkerScope {
  postMessage(message: SyncWorkerResponse): void;
  onmessage: ((event: MessageEvent<SyncWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (event) => {
  const { mic, webcam, opts } = event.data;
  try {
    const result = estimateSyncOffsetMs(mic, webcam, opts as SyncOptions);
    scope.postMessage({ ok: true, result });
  } catch (err) {
    scope.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
