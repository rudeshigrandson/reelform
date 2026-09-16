import {
  type LoudnessWorkerRequest,
  type LoudnessWorkerResponse,
  handleLoudnessRequest,
} from "./loudnessRunner";

/**
 * Integrated-loudness worker (SPEC §9.5 "via a worker on first enable"). Construct with
 * `new Worker(new URL("./loudness.worker.ts", import.meta.url), { type: "module" })`.
 */

interface WorkerScope {
  postMessage(message: LoudnessWorkerResponse): void;
  onmessage: ((event: MessageEvent<LoudnessWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (event) => {
  scope.postMessage(handleLoudnessRequest(event.data));
};
