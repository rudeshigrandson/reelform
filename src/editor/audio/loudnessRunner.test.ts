import { beforeEach, describe, expect, it } from "vitest";
import { integratedLoudness } from "./loudness";
import {
  type LoudnessWorkerLike,
  type LoudnessWorkerRequest,
  type LoudnessWorkerResponse,
  handleLoudnessRequest,
  measureLoudness,
  tracksToMeasure,
} from "./loudnessRunner";
import { useLoudnessStore } from "./loudnessStore";

const RATE = 48_000;

function sine(amplitude: number, seconds: number, hz = 1000): Float32Array {
  const out = new Float32Array(RATE * seconds);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

/** In-process worker: runs the real handler on the transferred request. */
function fakeWorker(respond?: (req: LoudnessWorkerRequest) => LoudnessWorkerResponse | "error") {
  const posted: { req: LoudnessWorkerRequest; transfer: Transferable[] }[] = [];
  const worker: LoudnessWorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(req, transfer) {
      posted.push({ req, transfer });
      queueMicrotask(() => {
        const res = respond ? respond(req) : handleLoudnessRequest(req);
        if (res === "error") worker.onerror?.({ message: "boom" });
        else worker.onmessage?.({ data: res });
      });
    },
    terminate() {
      this.terminated = true;
    },
  };
  return { worker, posted };
}

describe("measureLoudness", () => {
  it("measures a full-scale 1 kHz sine near −3 LUFS off-thread and transfers copies", async () => {
    const left = sine(1, 2);
    const decoded = { channels: [left], sampleRate: RATE };
    const { worker, posted } = fakeWorker();
    const lufs = await measureLoudness(decoded, () => worker);
    expect(lufs).toBeCloseTo(integratedLoudness([left], RATE), 6);
    expect(lufs).toBeGreaterThan(-4);
    expect(lufs).toBeLessThan(-2);
    expect(worker.terminated).toBe(true);
    // The worker got a copy; the cached decoded channel keeps its buffer.
    expect(posted[0]?.req.channels[0]).not.toBe(left);
    expect(posted[0]?.transfer).toEqual([posted[0]?.req.channels[0]?.buffer]);
    expect(left.length).toBe(RATE * 2);
  });

  it("falls back to measuring inline when workers are unavailable", async () => {
    const ch = sine(0.1, 1);
    expect(await measureLoudness({ channels: [ch, ch], sampleRate: RATE }, () => null)).toBeCloseTo(
      integratedLoudness([ch, ch], RATE),
      6,
    );
  });

  it("reports silence and empty input as −Infinity", async () => {
    const silent = new Float32Array(RATE);
    expect(await measureLoudness({ channels: [silent], sampleRate: RATE }, () => null)).toBe(
      Number.NEGATIVE_INFINITY,
    );
    expect(await measureLoudness({ channels: [], sampleRate: RATE })).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("rejects on worker errors and error responses", async () => {
    const decoded = { channels: [sine(0.5, 1)], sampleRate: RATE };
    const crashed = fakeWorker(() => "error");
    await expect(measureLoudness(decoded, () => crashed.worker)).rejects.toThrow("boom");
    expect(crashed.worker.terminated).toBe(true);
    const failed = fakeWorker(() => ({ ok: false, message: "bad input" }));
    await expect(measureLoudness(decoded, () => failed.worker)).rejects.toThrow("bad input");
  });

  it("the handler reports thrown meter errors", () => {
    expect(handleLoudnessRequest({ channels: [new Float32Array(4)], sampleRate: 0 })).toEqual({
      ok: false,
      message: "invalid loudness meter config",
    });
  });
});

describe("tracksToMeasure", () => {
  const tracks = (mic: boolean, system: boolean) => ({
    mic: { normalize: mic },
    system: { normalize: system },
  });

  it("picks tracks with normalize on, a source, and no measurement for that source", () => {
    const urls = { mic: "m://mic", system: "m://sys" };
    expect(tracksToMeasure(tracks(true, true), urls, {})).toEqual(["mic", "system"]);
    expect(tracksToMeasure(tracks(true, false), urls, {})).toEqual(["mic"]);
    expect(tracksToMeasure(tracks(true, true), urls, { mic: "m://mic" })).toEqual(["system"]);
    expect(tracksToMeasure(tracks(true, true), { mic: null }, {})).toEqual([]);
    // A replaced source is measured again.
    expect(tracksToMeasure(tracks(true, false), { mic: "m://new" }, { mic: "m://mic" })).toEqual([
      "mic",
    ]);
  });
});

describe("useLoudnessStore", () => {
  beforeEach(() => useLoudnessStore.getState().clear());

  it("stores LUFS per track and clears", () => {
    useLoudnessStore.getState().setLufs("mic", -20);
    useLoudnessStore.getState().setLufs("system", Number.NEGATIVE_INFINITY);
    expect(useLoudnessStore.getState().lufs).toEqual({
      mic: -20,
      system: Number.NEGATIVE_INFINITY,
    });
    useLoudnessStore.getState().clear();
    expect(useLoudnessStore.getState().lufs).toEqual({});
  });

  it("remembers the source each value came from and forgets one track", () => {
    const s = useLoudnessStore.getState();
    s.setLufs("mic", -18, "m://mic");
    s.setLufs("system", -22, "m://sys");
    expect(useLoudnessStore.getState().sources).toEqual({ mic: "m://mic", system: "m://sys" });
    useLoudnessStore.getState().forget("mic");
    expect(useLoudnessStore.getState().lufs).toEqual({ system: -22 });
    expect(useLoudnessStore.getState().sources).toEqual({ system: "m://sys" });
    useLoudnessStore.getState().clear();
    expect(useLoudnessStore.getState().sources).toEqual({});
  });
});
