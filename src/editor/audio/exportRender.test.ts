import { describe, expect, it } from "vitest";
import { initialEditorData } from "../store";
import {
  collectExportAudio,
  hasExportAudio,
  outputWindowFor,
  renderExportAudio,
  toExportAudioBuffer,
} from "./exportRender";
import { createFakeContext, fakeBuffer } from "./fakeAudioContext";
import type { FakeContext } from "./fakeAudioContext";
import type { ProcessorFactory } from "./graph";
import { framesFor } from "./render";
import type { OfflineContextFactory } from "./render";

function contexts() {
  const created: FakeContext[] = [];
  const createContext: OfflineContextFactory = (o) => {
    const ctx = createFakeContext(o.sampleRate, {
      length: o.length,
      channels: o.numberOfChannels,
      fill: () => 0.25,
    });
    created.push(ctx);
    return ctx;
  };
  return { created, createContext };
}

const settings = () => initialEditorData().audio;

describe("renderExportAudio", () => {
  it("returns null when there is nothing audible", () => {
    const { createContext, created } = contexts();
    const out = renderExportAudio({
      settings: settings(),
      sources: {},
      outputStartMs: 0,
      durationMs: 5000,
      createContext,
    });
    expect(out).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("is lazy: nothing renders until blocks are iterated, one block at a time", async () => {
    const { createContext, created } = contexts();
    const durationMs = 65_010.4;
    const out = renderExportAudio({
      settings: settings(),
      sources: { mic: fakeBuffer(70) },
      outputStartMs: 0,
      durationMs,
      createContext,
    });
    expect(out).not.toBeNull();
    const source = out as NonNullable<typeof out>;
    expect(created).toHaveLength(0);
    expect(source.length).toBe(framesFor(durationMs, 48_000));
    expect(source.numberOfChannels).toBe(2);
    expect(source.sampleRate).toBe(48_000);

    const offsets: number[] = [];
    for await (const block of source.blocks()) {
      offsets.push(block.frameOffset);
      // Only the block being yielded has been rendered.
      expect(created).toHaveLength(offsets.length);
      expect(block.channels[0].length).toBeLessThanOrEqual(framesFor(30_000, 48_000));
    }
    expect(offsets).toEqual([0, 1_440_000, 2_880_000]);

    const buf = await collectExportAudio(source);
    expect(buf.length).toBe(source.length);
    expect(buf.getChannelData(0)[buf.length - 1]).toBe(0.25);
    expect(buf.getChannelData(1)[0]).toBe(1.25); // fake fill adds the channel index
  });

  it("schedules the mic from the export start (range offset)", async () => {
    const { createContext, created } = contexts();
    const source = renderExportAudio({
      settings: settings(),
      sources: { mic: fakeBuffer(60) },
      outputStartMs: 10_000,
      durationMs: 2000,
      createContext,
    });
    await collectExportAudio(source as NonNullable<typeof source>);
    expect(created).toHaveLength(1);
    const starts = (created[0] as FakeContext).bufferSources().flatMap((s) => s.starts);
    expect(starts.length).toBeGreaterThan(0);
    // First block starts at output 10s with no pre-roll (offset 0 in the block).
    expect(starts[0]?.offset ?? 0).toBeCloseTo(10, 3);
  });

  it("forwards regions, click events, ducking, normalize loudness and noise reduction", async () => {
    const { createContext, created } = contexts();
    const s = settings();
    s.tracks.mic.normalize = true;
    s.tracks.mic.noiseReduction = true;
    s.clickVolume = 50;
    const region = {
      id: "music",
      fileName: "m.mp3",
      path: "media/m.mp3",
      startMs: 0,
      endMs: 4000,
      volumeDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      loop: false,
      duck: { enabled: true, amountDb: 12 },
      offsetMs: 500,
    };
    let nrSlots = 0;
    const noiseReduction: ProcessorFactory = (ctx) => {
      nrSlots++;
      const g = ctx.createGain();
      return { input: g, output: g };
    };
    const source = renderExportAudio({
      settings: s,
      sources: {
        mic: fakeBuffer(4),
        regions: { music: fakeBuffer(10) },
        clickSound: fakeBuffer(0.05),
      },
      clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0 }],
      regions: [region],
      clickEvents: [{ tMs: 1000 }],
      micEnvelope: { envelopeDb: [0, 0, 0, 0], sampleRateHz: 1 },
      processors: { noiseReduction },
      loudnessLufs: { mic: -22 },
      outputStartMs: 0,
      durationMs: 3000,
      createContext,
    });
    await collectExportAudio(source as NonNullable<typeof source>);
    const ctx = created[0] as FakeContext;
    const buffers = ctx.bufferSources().map((src) => src.buffer?.duration);
    expect(buffers).toContain(10); // region
    expect(buffers).toContain(0.05); // click sound
    const regionSrc = ctx.bufferSources().find((src) => src.buffer?.duration === 10);
    expect(regionSrc?.starts[0]?.offset).toBeCloseTo(0.5, 6);
    const clickSrc = ctx.bufferSources().find((src) => src.buffer?.duration === 0.05);
    expect(clickSrc?.starts[0]?.when).toBeCloseTo(1, 6);
    expect(nrSlots).toBe(1);
    // Normalize gain −16 − (−22) = +6 dB.
    expect(ctx.gains().some((g) => Math.abs(g.gain.value - 10 ** (6 / 20)) < 1e-6)).toBe(true);
    // Ducking automates the region gain with a curve.
    expect(ctx.gains().some((g) => g.gain.events.some((e) => e.type === "curve"))).toBe(true);
  });

  it("prepares a worklet-backed processor on every block context before building", async () => {
    const { createContext, created } = contexts();
    const s = settings();
    s.tracks.mic.noiseReduction = true;
    const prepared: unknown[] = [];
    const built: unknown[] = [];
    const noiseReduction = Object.assign(
      (ctx: Parameters<ProcessorFactory>[0]) => {
        built.push(ctx);
        expect(prepared).toContain(ctx);
        const g = ctx.createGain();
        return { input: g, output: g };
      },
      {
        prepare: async (ctx: unknown) => {
          prepared.push(ctx);
          return true;
        },
      },
    );
    const source = renderExportAudio({
      settings: s,
      sources: { mic: fakeBuffer(70) },
      processors: { noiseReduction },
      outputStartMs: 0,
      durationMs: 45_000,
      createContext,
    });
    await collectExportAudio(source as NonNullable<typeof source>);
    expect(created).toHaveLength(2);
    expect(prepared).toEqual(created);
    expect(built).toEqual(created);
  });

  it("stops on abort", async () => {
    const { createContext } = contexts();
    const ac = new AbortController();
    ac.abort();
    const source = renderExportAudio({
      settings: settings(),
      sources: { system: fakeBuffer(5) },
      outputStartMs: 0,
      durationMs: 5000,
      createContext,
      signal: ac.signal,
    });
    await expect(collectExportAudio(source as NonNullable<typeof source>)).rejects.toThrow(
      /abort/i,
    );
  });

  it("returns null for an empty duration", () => {
    const { createContext } = contexts();
    const out = renderExportAudio({
      settings: settings(),
      sources: { mic: fakeBuffer(1) },
      outputStartMs: 0,
      durationMs: 0,
      createContext,
    });
    expect(out).toBeNull();
  });
});

describe("helpers", () => {
  it("click sounds alone count as audio only when there are clicks", () => {
    expect(hasExportAudio({ clickSound: fakeBuffer(0.1) })).toBe(false);
    expect(hasExportAudio({ clickSound: fakeBuffer(0.1) }, [{ tMs: 10 }])).toBe(true);
  });

  it("maps a timeline range through speed regions", () => {
    expect(outputWindowFor({ startMs: 1000, endMs: 3000 })).toEqual({
      startMs: 1000,
      endMs: 3000,
    });
    const w = outputWindowFor({ startMs: 1000, endMs: 4000 }, [
      { startMs: 0, endMs: 2000, rate: 2 },
    ]);
    expect(w.startMs).toBeCloseTo(500, 6);
    expect(w.endMs).toBeCloseTo(3000, 6);
    expect(outputWindowFor({ startMs: 3000, endMs: 1000 })).toEqual({ startMs: 3000, endMs: 3000 });
  });

  it("wraps channels as an AudioBuffer-like and guards channel indices", () => {
    const buf = toExportAudioBuffer([new Float32Array(10), new Float32Array(8)], 48_000);
    expect(buf.length).toBe(8);
    expect(() => buf.getChannelData(2)).toThrow(RangeError);
  });
});
