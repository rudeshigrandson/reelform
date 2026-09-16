import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_SETTINGS } from "../../inspector/audio/types";
import { createFakeContext, fakeBuffer } from "../fakeAudioContext";
import type { AudioContextLike, AudioNodeLike } from "../graph";
import { buildAudioGraph } from "../graph";
import { RNNOISE_PROCESSOR_NAME, createNoiseReductionFactory } from "./index";

type WorkletCtx = AudioContextLike & {
  audioWorklet?: { addModule: (url: string) => Promise<void> };
};

function ctxWith(sampleRate: number, worklet = true) {
  const ctx = createFakeContext(sampleRate) as unknown as WorkletCtx;
  const addModule = vi.fn(async (_url: string) => {});
  if (worklet) ctx.audioWorklet = { addModule };
  return { ctx, addModule };
}

const wasmBytes = new Uint8Array([0, 97, 115, 109]).buffer;

function makeDeps() {
  const nodes: { name: string; bytes: ArrayBuffer; node: AudioNodeLike }[] = [];
  const deps = {
    workletUrl: vi.fn(async () => "blob:rnnoise-worklet"),
    loadWasm: vi.fn(async () => wasmBytes),
    createNode: vi.fn((ctx: AudioContextLike, name: string, o: { wasmBytes: ArrayBuffer }) => {
      const node = ctx.createGain();
      nodes.push({ name, bytes: o.wasmBytes, node });
      return node;
    }),
  };
  return { deps, nodes };
}

describe("createNoiseReductionFactory", () => {
  it("loads the worklet module into each context once, then builds worklet nodes", async () => {
    const { deps, nodes } = makeDeps();
    const nr = createNoiseReductionFactory(deps);
    const live = ctxWith(48_000);
    const offline = ctxWith(48_000);
    expect(await Promise.all([nr.prepare(live.ctx), nr.prepare(live.ctx)])).toEqual([true, true]);
    expect(await nr.prepare(offline.ctx)).toBe(true);
    expect(live.addModule).toHaveBeenCalledTimes(1);
    expect(live.addModule).toHaveBeenCalledWith("blob:rnnoise-worklet");
    expect(offline.addModule).toHaveBeenCalledTimes(1);
    expect(deps.loadWasm).toHaveBeenCalledTimes(1);

    const slot = nr(live.ctx);
    expect(slot.input).toBe(slot.output);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe(RNNOISE_PROCESSOR_NAME);
    expect(slot.input).toBe(nodes[0]?.node);
    // Each node gets its own copy of the wasm bytes.
    expect(nodes[0]?.bytes).not.toBe(wasmBytes);
    expect(nodes[0]?.bytes.byteLength).toBe(wasmBytes.byteLength);
    expect(nr.isReady(live.ctx)).toBe(true);
  });

  it("passes audio through when unprepared, unsupported, or not at 48 kHz", async () => {
    const { deps } = makeDeps();
    const nr = createNoiseReductionFactory(deps);
    const cold = ctxWith(48_000);
    const slot = nr(cold.ctx);
    expect(slot.input).toBe(slot.output);
    expect(nr.isReady(cold.ctx)).toBe(false);

    const noWorklet = ctxWith(48_000, false);
    expect(await nr.prepare(noWorklet.ctx)).toBe(false);
    const at44 = ctxWith(44_100);
    expect(await nr.prepare(at44.ctx)).toBe(false);
    expect(at44.addModule).not.toHaveBeenCalled();
    nr(at44.ctx);
    expect(deps.createNode).not.toHaveBeenCalled();
  });

  it("reports load failures and retries the wasm on a later context", async () => {
    const { deps } = makeDeps();
    const loadWasm = vi
      .fn<() => Promise<ArrayBuffer>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(wasmBytes);
    const nr = createNoiseReductionFactory({ ...deps, loadWasm });
    expect(await nr.prepare(ctxWith(48_000).ctx)).toBe(false);
    expect(await nr.prepare(ctxWith(48_000).ctx)).toBe(true);
    expect(loadWasm).toHaveBeenCalledTimes(2);

    const throwing = createNoiseReductionFactory({
      ...deps,
      createNode: () => {
        throw new Error("node failed");
      },
    });
    const c = ctxWith(48_000);
    await throwing.prepare(c.ctx);
    const slot = throwing(c.ctx);
    expect(slot.input).toBe(slot.output);
  });

  it("plugs into buildAudioGraph on the mic track when noise reduction is on", async () => {
    const { deps, nodes } = makeDeps();
    const nr = createNoiseReductionFactory(deps);
    const { ctx } = ctxWith(48_000);
    await nr.prepare(ctx);
    const settings = structuredClone(DEFAULT_AUDIO_SETTINGS);
    settings.tracks.mic.noiseReduction = true;
    buildAudioGraph({
      ctx,
      settings,
      sources: { mic: fakeBuffer(1) },
      processors: { noiseReduction: nr },
    });
    expect(nodes).toHaveLength(1);
    settings.tracks.mic.noiseReduction = false;
    buildAudioGraph({
      ctx,
      settings,
      sources: { mic: fakeBuffer(1) },
      processors: { noiseReduction: nr },
    });
    expect(nodes).toHaveLength(1);
  });
});
