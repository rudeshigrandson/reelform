import { describe, expect, it, vi } from "vitest";
import { collectExportAudio } from "../../editor/audio/exportRender";
import {
  type FakeContext,
  createFakeContext,
  fakeBuffer,
} from "../../editor/audio/fakeAudioContext";
import type { AudioBufferLike, ProcessorFactory } from "../../editor/audio/graph";
import { framesFor } from "../../editor/audio/render";
import type { OfflineContextFactory } from "../../editor/audio/render";
import type { AudioRegion } from "../../editor/inspector/audio/types";
import { initialEditorData } from "../../editor/store";
import {
  type AudioDecodePort,
  createExportAudioRenderer,
  loadAudioSources,
  loudnessForExport,
} from "./audioSources";

const decoder = (fail: string[] = [], durations: Record<string, number> = {}): AudioDecodePort => ({
  decode: vi.fn(async (url: string) => {
    if (fail.includes(url)) throw new Error("decode failed");
    return fakeBuffer(durations[url] ?? 40);
  }),
});

function contexts() {
  const created: FakeContext[] = [];
  const createContext: OfflineContextFactory = (o) => {
    const ctx = createFakeContext(o.sampleRate, { length: o.length, channels: 2 });
    created.push(ctx);
    return ctx;
  };
  return { created, createContext };
}

const signal = () => new AbortController().signal;
const BASE = "reelform-media://root/";

const region = (patch: Partial<AudioRegion> = {}): AudioRegion => ({
  id: "music",
  fileName: "song.mp3",
  path: "media/song.mp3",
  startMs: 0,
  endMs: 20_000,
  volumeDb: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  loop: false,
  duck: { enabled: true, amountDb: 12 },
  ...patch,
});

describe("loadAudioSources", () => {
  it("decodes available tracks and reports undecodable ones", async () => {
    const d = decoder(["sys.m4a"]);
    const res = await loadAudioSources(
      { micUrl: "mic.m4a", systemAudioUrl: "sys.m4a" },
      d,
      signal(),
    );
    expect(res.sources.mic).toBeDefined();
    expect(res.sources.system).toBeUndefined();
    expect(res.failed).toEqual(["system"]);
  });

  it("decodes regions by id and the click sound, reporting failures per input", async () => {
    const res = await loadAudioSources(
      {
        micUrl: null,
        systemAudioUrl: null,
        regions: [
          { id: "a", url: "a.mp3" },
          { id: "b", url: "b.mp3" },
        ],
        clickSoundUrl: "click.wav",
      },
      decoder(["b.mp3"], { "click.wav": 0.1 }),
      signal(),
    );
    expect(Object.keys(res.sources.regions ?? {})).toEqual(["a"]);
    expect(res.sources.clickSound?.duration).toBe(0.1);
    expect(res.failed).toEqual(["region:b"]);
  });

  it("skips missing URLs and rethrows when aborted", async () => {
    const none = await loadAudioSources(
      { micUrl: null, systemAudioUrl: null },
      decoder(),
      signal(),
    );
    expect(none).toEqual({ sources: {}, failed: [] });
    const ac = new AbortController();
    ac.abort();
    await expect(
      loadAudioSources(
        { micUrl: "mic.m4a", systemAudioUrl: null },
        decoder(["mic.m4a"]),
        ac.signal,
      ),
    ).rejects.toThrow("decode failed");
  });
});

describe("loudnessForExport", () => {
  it("prefers measured values and measures normalized tracks inline otherwise", () => {
    const settings = initialEditorData().audio;
    settings.tracks.mic.normalize = true;
    const tone = new Float32Array(48_000 * 2).map(
      (_, i) => 0.25 * Math.sin((2 * Math.PI * 1000 * i) / 48_000),
    );
    const mic: AudioBufferLike = {
      duration: 2,
      length: tone.length,
      sampleRate: 48_000,
      numberOfChannels: 1,
      getChannelData: () => tone,
    };
    const inline = loudnessForExport(settings, { mic, system: fakeBuffer(2) });
    expect(Number.isFinite(inline.mic)).toBe(true);
    // System isn't normalized → not measured.
    expect(inline.system).toBeUndefined();
    expect(loudnessForExport(settings, { mic }, { mic: -20 })).toEqual({ mic: -20 });
  });
});

describe("createExportAudioRenderer", () => {
  it("renders exactly the frame plan's output duration", async () => {
    const onDecodeFailed = vi.fn();
    const { createContext } = contexts();
    const render = createExportAudioRenderer({
      urls: { micUrl: "mic.m4a", systemAudioUrl: "sys.m4a" },
      settings: initialEditorData().audio,
      clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 40_000, timelineStartMs: 0 }],
      speeds: [],
      decoder: decoder(["sys.m4a"]),
      createContext,
      onDecodeFailed,
    });
    const out = await render({
      range: { startMs: 2000, endMs: 35_000 },
      outputDurationMs: 33_000,
      signal: signal(),
    });
    expect(out?.length).toBe(framesFor(33_000, 48_000));
    expect(onDecodeFailed).toHaveBeenCalledWith(["system"]);
  });

  it("mixes regions, the click pack, ducking, loudness and noise reduction", async () => {
    const { created, createContext } = contexts();
    const settings = initialEditorData().audio;
    settings.regions = [region()];
    settings.tracks.mic.noiseReduction = true;
    settings.tracks.mic.normalize = true;
    const d = decoder([], { "/sounds/soft/click.wav": 0.08, [`${BASE}media/song.mp3`]: 30 });
    let nr = 0;
    const noiseReduction: ProcessorFactory = (ctx) => {
      nr++;
      const g = ctx.createGain();
      return { input: g, output: g };
    };
    const render = createExportAudioRenderer({
      urls: { micUrl: "mic.m4a", systemAudioUrl: null },
      mediaBaseUrl: BASE,
      settings,
      clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 40_000, timelineStartMs: 0 }],
      speeds: [],
      clickSound: { type: "soft", volume: 60, customSound: null },
      telemetry: {
        clicks: [
          [1500, 0.5, 0.5, "left", "down"],
          [1600, 0.5, 0.5, "left", "up"],
        ],
      },
      loudnessLufs: () => ({ mic: -26 }),
      noiseReduction,
      decoder: d,
      createContext,
    });
    const out = await render({
      range: { startMs: 0, endMs: 5000 },
      outputDurationMs: 5000,
      signal: signal(),
    });
    expect(
      vi
        .mocked(d.decode)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["/sounds/soft/click.wav", `${BASE}media/song.mp3`, "mic.m4a"].sort());
    // Lazy: decoding happened, rendering didn't.
    expect(created).toHaveLength(0);
    await collectExportAudio(out as NonNullable<typeof out>);
    const ctx = created[0] as FakeContext;
    const durations = ctx.bufferSources().map((s) => s.buffer?.duration);
    expect(durations).toContain(30);
    const click = ctx.bufferSources().find((s) => s.buffer?.duration === 0.08);
    expect(click?.starts[0]?.when).toBeCloseTo(1.5, 6);
    expect(nr).toBe(1);
    // −16 − (−26) = +10 dB normalize gain.
    expect(ctx.gains().some((g) => Math.abs(g.gain.value - 10 ** (10 / 20)) < 1e-6)).toBe(true);
    // Mic present + ducking region → the region gain is automated.
    expect(ctx.gains().some((g) => g.gain.events.some((e) => e.type === "curve"))).toBe(true);
  });

  it("skips noise reduction when it is off and click events without a click pack", async () => {
    const { created, createContext } = contexts();
    let nr = 0;
    const render = createExportAudioRenderer({
      urls: { micUrl: "mic.m4a", systemAudioUrl: null },
      settings: initialEditorData().audio,
      clips: [],
      speeds: [],
      clickSound: { type: "none", volume: 60, customSound: null },
      telemetry: { clicks: [[100, 0, 0, "left", "down"]] },
      noiseReduction: (ctx) => {
        nr++;
        const g = ctx.createGain();
        return { input: g, output: g };
      },
      decoder: decoder(),
      createContext,
    });
    const out = await render({
      range: { startMs: 0, endMs: 1000 },
      outputDurationMs: 1000,
      signal: signal(),
    });
    await collectExportAudio(out as NonNullable<typeof out>);
    expect(nr).toBe(0);
    expect(created[0]?.bufferSources().every((s) => s.buffer?.duration === 40)).toBe(true);
  });

  it("returns null when the project has no audio tracks", async () => {
    const { createContext } = contexts();
    const render = createExportAudioRenderer({
      urls: { micUrl: null, systemAudioUrl: null },
      settings: initialEditorData().audio,
      clips: [],
      speeds: [],
      decoder: decoder(),
      createContext,
    });
    await expect(
      render({ range: { startMs: 0, endMs: 1000 }, outputDurationMs: 1000, signal: signal() }),
    ).resolves.toBeNull();
  });
});
