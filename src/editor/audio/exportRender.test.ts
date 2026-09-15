import { describe, expect, it } from "vitest";
import { initialEditorData } from "../store";
import { outputWindowFor, renderExportAudio, toExportAudioBuffer } from "./exportRender";
import { createFakeContext, fakeBuffer } from "./fakeAudioContext";
import type { FakeContext } from "./fakeAudioContext";
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
  it("returns null when there is nothing audible", async () => {
    const { createContext, created } = contexts();
    const out = await renderExportAudio({
      settings: settings(),
      sources: {},
      outputStartMs: 0,
      durationMs: 5000,
      createContext,
    });
    expect(out).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("renders 30s blocks to exactly framesFor(duration) stereo frames", async () => {
    const { createContext, created } = contexts();
    const durationMs = 65_010.4;
    const out = await renderExportAudio({
      settings: settings(),
      sources: { mic: fakeBuffer(70) },
      outputStartMs: 0,
      durationMs,
      createContext,
    });
    expect(out).not.toBeNull();
    const buf = out as NonNullable<typeof out>;
    expect(buf.length).toBe(framesFor(durationMs, 48_000));
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.sampleRate).toBe(48_000);
    expect(buf.duration).toBeCloseTo(buf.length / 48_000, 9);
    expect(created).toHaveLength(3);
    expect(buf.getChannelData(0)[buf.length - 1]).toBe(0.25);
    expect(buf.getChannelData(1)[0]).toBe(1.25); // fake fill adds the channel index
  });

  it("schedules the mic from the export start (range offset)", async () => {
    const { createContext, created } = contexts();
    await renderExportAudio({
      settings: settings(),
      sources: { mic: fakeBuffer(60) },
      outputStartMs: 10_000,
      durationMs: 2000,
      createContext,
    });
    expect(created).toHaveLength(1);
    const starts = (created[0] as FakeContext).bufferSources().flatMap((s) => s.starts);
    expect(starts.length).toBeGreaterThan(0);
    // First block starts at output 10s with no pre-roll (offset 0 in the block).
    expect(starts[0]?.offset ?? 0).toBeCloseTo(10, 3);
  });

  it("stops on abort", async () => {
    const { createContext } = contexts();
    const ac = new AbortController();
    ac.abort();
    await expect(
      renderExportAudio({
        settings: settings(),
        sources: { system: fakeBuffer(5) },
        outputStartMs: 0,
        durationMs: 5000,
        createContext,
        signal: ac.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it("returns null for an empty duration", async () => {
    const { createContext } = contexts();
    const out = await renderExportAudio({
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
