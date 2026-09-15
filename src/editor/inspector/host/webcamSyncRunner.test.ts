import { describe, expect, it } from "vitest";
import { estimateSyncOffsetMs } from "./webcamSync";
import {
  type SyncWorkerLike,
  type SyncWorkerRequest,
  type SyncWorkerResponse,
  estimateSyncOffsetOffThread,
  syncPrefix,
} from "./webcamSyncRunner";

const RATE = 1000;

function bursts(totalMs: number, on: readonly [number, number][]): Float32Array {
  const out = new Float32Array(totalMs);
  for (const [s, e] of on) for (let i = s; i < e && i < totalMs; i++) out[i] = i % 2 ? 0.5 : -0.5;
  return out;
}

const segs: [number, number][] = [
  [300, 700],
  [1500, 2300],
  [4000, 4200],
  [6000, 7500],
];
const mic = { samples: bursts(12_000, segs), sampleRate: RATE };
const cam = {
  samples: bursts(
    12_000,
    segs.map(([s, e]) => [s + 400, e + 400]),
  ),
  sampleRate: RATE,
};

/** In-process worker: runs the real estimator on the transferred request. */
function fakeWorker(respond?: (req: SyncWorkerRequest) => SyncWorkerResponse | "error") {
  const posted: { req: SyncWorkerRequest; transfer: Transferable[] }[] = [];
  const worker: SyncWorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    terminate() {
      this.terminated = true;
    },
    postMessage(req, transfer) {
      posted.push({ req, transfer });
      queueMicrotask(() => {
        const out = respond
          ? respond(req)
          : { ok: true as const, result: estimateSyncOffsetMs(req.mic, req.webcam, req.opts) };
        if (out === "error") worker.onerror?.({ message: "crashed" });
        else worker.onmessage?.({ data: out });
      });
    },
  };
  return { worker, posted };
}

describe("estimateSyncOffsetOffThread", () => {
  it("runs inline when no worker is available and matches the pure estimator", async () => {
    const res = await estimateSyncOffsetOffThread(mic, cam, {}, () => null);
    expect(res).toEqual(estimateSyncOffsetMs(mic, cam));
    expect(res?.offsetMs).toBe(400);
  });

  it("posts copied prefixes to the worker, keeps the source buffers attached, terminates", async () => {
    const { worker, posted } = fakeWorker();
    const res = await estimateSyncOffsetOffThread(
      mic,
      cam,
      { windowMs: 10_000, maxLagMs: 1000 },
      () => worker,
    );
    expect(res?.offsetMs).toBe(400);
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    const first = posted[0];
    expect(first?.req.mic.samples.length).toBe(10_000);
    expect(first?.req.webcam.samples.length).toBe(11_000);
    expect(first?.transfer).toHaveLength(2);
    // Transfer targets are copies: the caller's (cached) buffers are untouched.
    expect(first?.req.mic.samples.buffer).not.toBe(mic.samples.buffer);
    expect(mic.samples.length).toBe(12_000);
  });

  it("rejects on a worker error or failure response and still terminates", async () => {
    const crash = fakeWorker(() => "error");
    await expect(estimateSyncOffsetOffThread(mic, cam, {}, () => crash.worker)).rejects.toThrow(
      "crashed",
    );
    expect(crash.worker.terminated).toBe(true);

    const fail = fakeWorker(() => ({ ok: false, message: "bad input" }));
    await expect(estimateSyncOffsetOffThread(mic, cam, {}, () => fail.worker)).rejects.toThrow(
      "bad input",
    );
    expect(fail.worker.terminated).toBe(true);
  });

  it("resolves null for silence", async () => {
    const silent = { samples: new Float32Array(5000), sampleRate: RATE };
    const { worker } = fakeWorker();
    await expect(estimateSyncOffsetOffThread(silent, silent, {}, () => worker)).resolves.toBeNull();
  });
});

describe("syncPrefix", () => {
  it("copies at most the requested duration", () => {
    const t = { samples: new Float32Array([1, 2, 3, 4]), sampleRate: 1000 };
    const p = syncPrefix(t, 2);
    expect([...p.samples]).toEqual([1, 2]);
    p.samples[0] = 9;
    expect(t.samples[0]).toBe(1);
    expect(syncPrefix(t, 10_000).samples).toHaveLength(4);
  });
});
