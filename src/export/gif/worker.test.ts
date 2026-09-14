import { describe, expect, it, vi } from "vitest";
import { type GifWorkerLike, createGifEncoderClient } from "./client";
import type { GifProgressMessage, GifWorkerRequest, GifWorkerResponse } from "./protocol";
import { concat, gradientFrame, solidFrame } from "./testing/frames";
import { decodeGif } from "./testing/gifDecoder";
import type { GifEncoderOptions } from "./types";
import { createGifWorkerHost } from "./workerHost";

const OPTS: GifEncoderOptions = {
  width: 20,
  height: 10,
  fps: 20,
  colors: 64,
  dither: "bayer4",
  loop: true,
  totalFrames: 3,
};

/** In-memory Worker: messages hop through microtasks to a real worker host. */
function fakeWorker(intercept?: (m: GifWorkerRequest) => GifWorkerRequest | null) {
  const posted: GifWorkerRequest[] = [];
  let terminated = false;
  const worker: GifWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      posted.push(message);
      const m = intercept ? intercept(message) : message;
      if (m) queueMicrotask(() => host.handle(m));
    },
    terminate() {
      terminated = true;
    },
  };
  const host = createGifWorkerHost((msg) => {
    queueMicrotask(() => {
      if (!terminated) worker.onmessage?.({ data: msg });
    });
  });
  return { worker, posted, isTerminated: () => terminated };
}

describe("createGifWorkerHost", () => {
  it("encodes via messages and emits progress, ordered chunks and done", () => {
    const out: GifWorkerResponse[] = [];
    const transfers: ArrayBuffer[][] = [];
    const host = createGifWorkerHost((m, t) => {
      out.push(m);
      transfers.push(t);
    });
    host.handle({ type: "init", options: OPTS });
    const f = gradientFrame(20, 10);
    host.handle({ type: "sample", width: 20, height: 10, buffer: f.data.slice().buffer });
    for (let i = 0; i < 3; i++)
      host.handle({
        type: "addFrame",
        index: i,
        width: 20,
        height: 10,
        buffer: solidFrame(20, 10, [i * 80, 0, 0]).data.buffer,
      });
    host.handle({ type: "finish" });

    const progress = out.filter((m): m is GifProgressMessage => m.type === "progress");
    expect(progress.map((p) => p.frameIndex)).toEqual([0, 1, 2]);
    expect(progress[2]).toMatchObject({ framesEncoded: 3, totalFrames: 3, estimateSettled: true });
    const chunks = out.flatMap((m) => (m.type === "chunk" ? [new Uint8Array(m.bytes)] : []));
    const bytes = concat(chunks);
    expect(out.at(-1)).toEqual({ type: "done", totalBytes: bytes.length, frames: 3 });
    // chunk buffers are listed for transfer
    out.forEach((m, i) => {
      if (m.type === "chunk") expect(transfers[i]).toEqual([m.bytes]);
    });
    const gif = decodeGif(bytes);
    expect(gif.frames.map((fr) => fr.delayCs)).toEqual([5, 5, 5]);
  });

  it("reports invalid messages, uninitialised use and encoder errors, then goes quiet", () => {
    const cases: unknown[][] = [
      [{ type: "bogus" }],
      [{ type: "finish" }],
      [
        { type: "init", options: OPTS },
        { type: "addFrame", index: 0, width: 5, height: 5, buffer: new ArrayBuffer(100) },
      ],
      [{ type: "init", options: OPTS }, { type: "finish" }],
    ];
    for (const msgs of cases) {
      const out: GifWorkerResponse[] = [];
      const host = createGifWorkerHost((m) => out.push(m));
      for (const m of msgs) host.handle(m);
      host.handle({ type: "finish" });
      expect(out).toHaveLength(1);
      expect(out[0]?.type).toBe("error");
    }
  });

  it("cancel stops all further output", () => {
    const post = vi.fn();
    const host = createGifWorkerHost(post);
    host.handle({ type: "init", options: OPTS });
    host.handle({ type: "cancel" });
    host.handle({
      type: "addFrame",
      index: 0,
      width: 20,
      height: 10,
      buffer: new ArrayBuffer(800),
    });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("createGifEncoderClient", () => {
  it("end-to-end: frames in, ordered async chunks out, decodable GIF", async () => {
    const { worker, posted, isTerminated } = fakeWorker();
    const chunks: Uint8Array[] = [];
    const progress: GifProgressMessage[] = [];
    const client = createGifEncoderClient({
      createWorker: () => worker,
      onChunk: async (b) => {
        await Promise.resolve();
        chunks.push(b);
      },
      onProgress: (p) => progress.push(p),
    });
    client.init(OPTS);
    client.addSample(gradientFrame(20, 10));
    const p0 = await client.addFrame(solidFrame(20, 10, [255, 0, 0]));
    expect(p0.frameIndex).toBe(0);
    await client.addFrame(solidFrame(20, 10, [0, 255, 0]));
    await client.addFrame(solidFrame(20, 10, [0, 0, 255]));
    const done = await client.finish();
    const bytes = concat(chunks);
    expect(done.totalBytes).toBe(bytes.length);
    expect(decodeGif(bytes).frames).toHaveLength(3);
    expect(progress).toHaveLength(3);
    expect(isTerminated()).toBe(true);
    expect(posted.map((m) => m.type)).toEqual([
      "init",
      "sample",
      "addFrame",
      "addFrame",
      "addFrame",
      "finish",
    ]);
  });

  it("copies frame views that do not own their whole buffer", async () => {
    const { worker, posted } = fakeWorker();
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    client.init({ ...OPTS, width: 2, height: 1 });
    const big = new Uint8ClampedArray(64);
    const view = new Uint8ClampedArray(big.buffer, 8, 8);
    await client.addFrame({ width: 2, height: 1, data: view });
    const msg = posted[1];
    expect(msg?.type === "addFrame" && msg.buffer.byteLength).toBe(8);
  });

  it("worker error rejects pending frames and later calls", async () => {
    const { worker } = fakeWorker();
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    client.init(OPTS);
    await expect(client.addFrame(solidFrame(4, 4, [0, 0, 0]))).rejects.toThrow(/does not match/);
    await expect(client.addFrame(solidFrame(20, 10, [0, 0, 0]))).rejects.toThrow(/does not match/);
    await expect(client.finish()).rejects.toThrow();
  });

  it("worker crash (onerror) and chunk sink failures reject", async () => {
    const { worker } = fakeWorker((m) => (m.type === "addFrame" ? null : m));
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    client.init(OPTS);
    const pending = client.addFrame(solidFrame(20, 10, [0, 0, 0]));
    worker.onerror?.({ message: "boom" });
    await expect(pending).rejects.toThrow("boom");

    const w2 = fakeWorker();
    const c2 = createGifEncoderClient({
      createWorker: () => w2.worker,
      onChunk: () => Promise.reject(new Error("disk full")),
    });
    c2.init({ ...OPTS, totalFrames: 1 });
    // The header chunk is written with frame 0, so the sink failure surfaces on addFrame.
    await expect(c2.addFrame(solidFrame(20, 10, [0, 0, 0]))).rejects.toThrow("disk full");
    await expect(c2.finish()).rejects.toThrow("disk full");
  });

  it("cancel posts cancel and rejects in-flight work", async () => {
    const { worker, posted } = fakeWorker((m) => (m.type === "addFrame" ? null : m));
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    client.init(OPTS);
    const pending = client.addFrame(solidFrame(20, 10, [0, 0, 0]));
    client.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(posted.at(-1)).toEqual({ type: "cancel" });
    expect(() => client.addSample(solidFrame(20, 10, [0, 0, 0]))).toThrow(/cancelled/);
  });

  it("init twice throws; calls before init reject", async () => {
    const { worker } = fakeWorker();
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    await expect(client.addFrame(solidFrame(20, 10, [0, 0, 0]))).rejects.toThrow(/not initialised/);
    client.init(OPTS);
    expect(() => client.init(OPTS)).toThrow(/already/);
  });
});

describe("createGifEncoderClient buffers and backpressure", () => {
  it("never transfers a larger backing buffer (view at offset 0)", async () => {
    const { worker, posted } = fakeWorker();
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    client.init({ ...OPTS, width: 2, height: 1 });
    const big = new Uint8ClampedArray(64);
    await client.addFrame({ width: 2, height: 1, data: new Uint8ClampedArray(big.buffer, 0, 8) });
    const msg = posted[1];
    expect(msg?.type === "addFrame" && msg.buffer.byteLength).toBe(8);
    expect(msg?.type === "addFrame" && msg.buffer).not.toBe(big.buffer);
  });

  it("rejects frames whose data is too short without posting", async () => {
    const { worker, posted } = fakeWorker();
    const client = createGifEncoderClient({ createWorker: () => worker, onChunk: () => undefined });
    client.init(OPTS);
    await expect(
      client.addFrame({ width: 20, height: 10, data: new Uint8ClampedArray(10) }),
    ).rejects.toThrow(/too short/);
    expect(posted.map((m) => m.type)).toEqual(["init"]);
  });

  it("addFrame resolves only after the frame's chunks were written by onChunk", async () => {
    const { worker } = fakeWorker();
    const releases: (() => void)[] = [];
    let written = 0;
    const client = createGifEncoderClient({
      createWorker: () => worker,
      onChunk: () =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            written++;
            resolve();
          });
        }),
    });
    client.init(OPTS);
    // Sample both colors so frame 1 is not quantized onto frame 0's (merged, chunk-less) color.
    client.addSample(solidFrame(20, 10, [255, 0, 0]));
    client.addSample(solidFrame(20, 10, [0, 0, 255]));
    const flushTicks = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };
    for (const [k, color] of [
      [0, [255, 0, 0]],
      [1, [0, 0, 255]],
    ] as const) {
      let resolved = false;
      const p = client.addFrame(solidFrame(20, 10, [...color])).then(() => {
        resolved = true;
      });
      await flushTicks();
      // Frame 0 emits the header chunk; frame 1 flushes frame 0's image chunk.
      expect(releases.length).toBe(1);
      expect(resolved).toBe(false);
      releases.shift()?.();
      await p;
      expect(written).toBe(k + 1);
      expect(resolved).toBe(true);
    }
  });
});
