import { describe, expect, it, vi } from "vitest";
import { ExportCancelledError } from "../../export/engine/cancel";
import type { ExportProgress } from "../../export/engine/progress";
import { StreamingDecoder } from "../../export/engine/streamingDecoder";
import {
  FakePacketSource,
  FakeRenderer,
  FakeVideoDecoder,
  FrameLedger,
} from "../../export/engine/testFakes";
import type { GifWorkerLike } from "../../export/gif/client";
import type { GifWorkerRequest } from "../../export/gif/protocol";
import { solidFrame } from "../../export/gif/testing/frames";
import { decodeGif } from "../../export/gif/testing/gifDecoder";
import { createGifWorkerHost } from "../../export/gif/workerHost";
import { createGifRoute } from "./gifRoute";
import type { GifRouteArgs } from "./runner";
import { FakeFlowSink, sceneInputFor } from "./testFakes";

/** In-process worker: requests hop through microtasks into a real GIF worker host. */
function fakeWorker(onPost?: (m: GifWorkerRequest) => void) {
  const state = { terminated: false, posted: [] as GifWorkerRequest["type"][] };
  const worker: GifWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      state.posted.push(message.type);
      onPost?.(message);
      queueMicrotask(() => host.handle(message));
    },
    terminate() {
      state.terminated = true;
    },
  };
  // Clone with transfer like a real worker so the encoder cannot reuse posted buffers.
  const host = createGifWorkerHost((m, transfer) => {
    const copy = structuredClone(m, { transfer });
    queueMicrotask(() => worker.onmessage?.({ data: copy }));
  });
  return { worker, state };
}

function setup(durationMs = 1000, fps: 10 | 15 = 10) {
  const ledger = new FrameLedger();
  const renderer = new FakeRenderer(ledger);
  const destroy = vi.spyOn(renderer, "destroy");
  const w = fakeWorker();
  const pixels: number[] = [];
  let clock = 0;
  const route = createGifRoute({
    timeline: {
      clips: [{ id: "c1", sourceStartMs: 0, sourceEndMs: 5000, timelineStartMs: 0 }],
      speeds: [],
      sourceFps: 30,
      sceneInput: sceneInputFor,
    },
    createWorker: () => w.worker,
    openFrameSource: async () =>
      new StreamingDecoder({
        source: new FakePacketSource(150, 30, 30),
        createDecoder: (init) => new FakeVideoDecoder(init, ledger),
      }),
    createRenderer: async () => renderer,
    readPixels: async (_image, width, height) => {
      pixels.push(width * height);
      const shade = (pixels.length * 37) % 255;
      return solidFrame(width, height, [shade, 255 - shade, 80]);
    },
    now: () => {
      clock += 5;
      return clock;
    },
  });
  const sink = new FakeFlowSink("/exports/Demo.gif");
  const progress: { p: ExportProgress; est: number | null }[] = [];
  const args = (signal: AbortSignal): GifRouteArgs => ({
    options: { width: 32, height: 18, fps, colors: 64, dither: "none", loop: true },
    range: { startMs: 0, endMs: durationMs },
    burnInCaptions: false,
    sink,
    signal,
    onProgress: (p, est) => progress.push({ p, est }),
  });
  return { route, sink, progress, args, w, renderer, destroy, pixels };
}

describe("GIF route", () => {
  it("streams a valid GIF through the sink with palette samples first", async () => {
    const t = setup(1000, 10);
    const res = await t.route(t.args(new AbortController().signal));
    expect(res).toMatchObject({ path: "/exports/Demo.gif", frames: 10 });
    expect(t.sink.events).toEqual(["begin", "finish"]);
    expect(t.sink.infos[0]).toEqual({ container: "gif" });
    expect(res.bytes).toBe(t.sink.size);
    const gif = decodeGif(t.sink.contents());
    // Unchanged frames may merge into a longer delay; total playback time is exact.
    expect(gif.frames.reduce((s, f) => s + f.delayCs, 0)).toBe(100);
    expect(gif.width).toBe(32);
    expect(t.w.state.posted[0]).toBe("init");
    expect(t.w.state.posted.filter((x) => x === "sample")).toHaveLength(1);
    expect(t.w.state.posted.indexOf("sample")).toBeLessThan(t.w.state.posted.indexOf("addFrame"));
    expect(t.renderer.calls).toHaveLength(11); // 1 sample + 10 frames
    const last = t.progress.at(-1);
    expect(last?.p.phase).toBe("finalizing");
    expect(last?.p.fraction).toBe(1);
    expect(t.progress.some((x) => x.est !== null)).toBe(true);
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("adaptive palettes skip the sampling pass", async () => {
    const t = setup(500, 10);
    const a = t.args(new AbortController().signal);
    await t.route({ ...a, options: { ...a.options, adaptivePalette: true } });
    expect(t.w.state.posted).not.toContain("sample");
    expect(t.renderer.calls).toHaveLength(5);
  });

  it("cancel mid-export rejects, cancels the sink and stops the worker", async () => {
    const t = setup(3000, 10);
    const ac = new AbortController();
    t.renderer.onRender = (n) => {
      if (n === 6) ac.abort();
    };
    await expect(t.route(t.args(ac.signal))).rejects.toBeInstanceOf(ExportCancelledError);
    expect(t.sink.events).toEqual(["begin", "cancel"]);
    expect(t.w.state.terminated).toBe(true);
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("a sink write failure fails the export and discards the file", async () => {
    const t = setup(1000, 10);
    t.sink.writeChunk = async () => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    };
    await expect(t.route(t.args(new AbortController().signal))).rejects.toThrow("disk full");
    expect(t.sink.events).toContain("cancel");
  });

  it("rejects an empty range before touching the sink", async () => {
    const t = setup(0, 10);
    await expect(t.route(t.args(new AbortController().signal))).rejects.toThrow(/empty/);
    expect(t.sink.events).toEqual([]);
  });
});
