import { DEFAULT_AUDIO_SETTINGS, DEFAULT_DUCK } from "../inspector/audio/types";
import type { AudioSettings } from "../inspector/audio/types";
import { LIMITER_SETTINGS } from "./dsp";
import { type FakeNode, createFakeContext, fakeBuffer } from "./fakeAudioContext";
import { type GraphAudioRegion, buildAudioGraph } from "./graph";

const S = DEFAULT_AUDIO_SETTINGS;

function withTracks(patch: {
  mic?: Partial<AudioSettings["tracks"]["mic"]>;
  system?: Partial<AudioSettings["tracks"]["system"]>;
  master?: Partial<AudioSettings["master"]>;
}): AudioSettings {
  return {
    ...S,
    tracks: {
      mic: { ...S.tracks.mic, ...patch.mic },
      system: { ...S.tracks.system, ...patch.system },
    },
    master: { ...S.master, ...patch.master },
  };
}

function region(p: Partial<GraphAudioRegion> = {}): GraphAudioRegion {
  return {
    id: "music",
    fileName: "m.mp3",
    path: "media/m.mp3",
    startMs: 1000,
    endMs: 5000,
    volumeDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    loop: false,
    duck: { ...DEFAULT_DUCK, enabled: false },
    ...p,
  };
}

const edges = (nodes: FakeNode[]) =>
  nodes.flatMap((n) => n.outputs.map((o) => `${n.label}->${o.label}`));

describe("buildAudioGraph wiring", () => {
  it("sources → track gains → master → limiter → destination", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: S,
      sources: { mic: fakeBuffer(10), system: fakeBuffer(10) },
    });
    const master = g.master as unknown as FakeNode;
    const limiter = g.limiter as unknown as FakeNode;
    expect(limiter.outputs).toEqual([ctx.destination]);
    expect(master.outputs).toEqual([limiter]);
    expect((g.tracks.mic as unknown as FakeNode).outputs).toEqual([master]);
    expect((g.tracks.system as unknown as FakeNode).outputs).toEqual([master]);
    const srcs = ctx.bufferSources();
    expect(srcs).toHaveLength(2);
    expect(srcs[0]?.outputs).toEqual([g.tracks.mic]);
    expect(srcs[1]?.outputs).toEqual([g.tracks.system]);
    expect(srcs[0]?.starts).toEqual([{ when: 0, offset: 0, duration: 10 }]);
    expect(g.outputDurationMs).toBe(10_000);
    expect(g.limiter.threshold.value).toBe(LIMITER_SETTINGS.thresholdDb);
    expect(g.limiter.knee.value).toBe(0);
    expect(g.limiter.ratio.value).toBe(LIMITER_SETTINGS.ratio);
    // Everything eventually reaches the destination exactly once.
    expect(edges(ctx.nodes).filter((e) => e.endsWith(`->${ctx.destination.label}`))).toHaveLength(
      1,
    );
  });

  it("inserts noise reduction (mic only) and normalize gain in order", () => {
    const ctx = createFakeContext();
    const nrIn = ctx.createGain() as unknown as FakeNode;
    const nrOut = ctx.createGain() as unknown as FakeNode;
    const factory = vi.fn(() => ({ input: nrIn, output: nrOut }));
    const settings = withTracks({
      mic: { noiseReduction: true, normalize: true },
      system: { normalize: true },
    });
    const g = buildAudioGraph({
      ctx,
      settings,
      sources: { mic: fakeBuffer(5), system: fakeBuffer(5) },
      loudnessLufs: { mic: -26 },
      processors: { noiseReduction: factory },
    });
    expect(factory).toHaveBeenCalledTimes(1);
    const micGain = g.tracks.mic as unknown as FakeNode;
    expect(micGain.outputs).toEqual([nrIn]);
    const norm = nrOut.outputs[0] as FakeNode & { gain: { value: number } };
    expect(norm.kind).toBe("gain");
    expect(norm.gain.value).toBeCloseTo(10 ** (10 / 20), 6); // −26 → −16 LUFS
    expect(norm.outputs).toEqual([g.master]);
    // System normalize without a measurement → unity (never guesses).
    const sysNorm = (g.tracks.system as unknown as FakeNode).outputs[0] as FakeNode & {
      gain: { value: number };
    };
    expect(sysNorm.gain.value).toBe(1);
  });

  it("no noise-reduction slot when disabled or no factory", () => {
    const ctx = createFakeContext();
    const factory = vi.fn();
    const g = buildAudioGraph({
      ctx,
      settings: S,
      sources: { mic: fakeBuffer(1) },
      processors: { noiseReduction: factory },
    });
    expect(factory).not.toHaveBeenCalled();
    expect((g.tracks.mic as unknown as FakeNode).outputs).toEqual([g.master]);
    expect(g.tracks.system).toBeUndefined();
  });

  it("solo / mute: solo mic zeroes system + regions + clicks and skips their sources", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: withTracks({ mic: { solo: true } }),
      sources: {
        mic: fakeBuffer(10),
        system: fakeBuffer(10),
        regions: { music: fakeBuffer(3) },
        clickSound: fakeBuffer(0.05),
      },
      regions: [region()],
      clickEvents: [{ tMs: 2000 }],
    });
    expect(g.tracks.mic?.gain.value).toBe(1);
    expect(g.tracks.system?.gain.value).toBe(0);
    expect(g.regions.music?.gain.value).toBe(0);
    expect(g.clicks?.gain.value).toBe(0);
    expect(ctx.bufferSources().map((s) => s.outputs[0])).toEqual([g.tracks.mic]);
  });

  it("mute-all sets master to 0", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: withTracks({ master: { muteAll: true } }),
      sources: { mic: fakeBuffer(1) },
    });
    expect(g.master.gain.value).toBe(0);
  });

  it("volume dB → gain; −∞ is silent", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: withTracks({
        mic: { volumeDb: -6 },
        system: { volumeDb: Number.NEGATIVE_INFINITY },
      }),
      sources: { mic: fakeBuffer(1), system: fakeBuffer(1) },
    });
    expect(g.tracks.mic?.gain.value).toBeCloseTo(0.501187, 5);
    expect(g.tracks.system?.gain.value).toBe(0);
  });
});

describe("scheduling", () => {
  it("regions: start offset, fades as value curves, loop", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: S,
      sources: { regions: { music: fakeBuffer(1.5), vo: fakeBuffer(10) } },
      regions: [
        region({ loop: true, fadeInMs: 500 }),
        region({ id: "vo", startMs: 0, endMs: 2000, offsetMs: 9000 }),
      ],
    });
    const [music, vo] = ctx.bufferSources();
    expect(music?.loop).toBe(true);
    expect(music?.loopEnd).toBe(1.5);
    expect(music?.starts).toEqual([{ when: 1, offset: 0, duration: 4 }]);
    // Non-looping VO has only 1s left in its file after the 9s offset.
    expect(vo?.starts).toEqual([{ when: 0, offset: 9, duration: 1 }]);
    const ev = (
      g.regions.music?.gain as unknown as {
        events: Array<{ type: string; values?: Float32Array; time: number; duration?: number }>;
      }
    ).events;
    expect(ev).toHaveLength(1);
    expect(ev[0]?.type).toBe("curve");
    expect(ev[0]?.time).toBe(1);
    expect(ev[0]?.duration).toBe(4);
    expect(ev[0]?.values?.[0]).toBe(0);
    expect(ev[0]?.values?.[ev[0].values.length - 1]).toBe(1);
    expect(g.extentMs).toBe(5000);
  });

  it("click sounds scheduled at click tMs (through speed regions)", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: { ...S, clickVolume: 50 },
      sources: { system: fakeBuffer(10), clickSound: fakeBuffer(0.1) },
      speeds: [{ startMs: 0, endMs: 4000, rate: 2 }],
      clickEvents: [{ tMs: 1000 }, { tMs: 6000 }, { tMs: -5 }, { tMs: 99_999 }],
    });
    expect(g.clicks?.gain.value).toBe(0.5);
    const clicks = ctx
      .bufferSources()
      .filter((s) => s.outputs[0] === (g.clicks as unknown as FakeNode));
    expect(clicks.map((c) => c.starts[0]?.when)).toEqual([0.5, 4]);
    expect(g.outputDurationMs).toBe(8000);
    const sys = ctx.bufferSources().filter((s) => s.outputs[0] === g.tracks.system);
    expect(sys.map((s) => [s.playbackRate.value, s.starts[0]])).toEqual([
      [2, { when: 0, offset: 0, duration: 4 }],
      [1, { when: 2, offset: 4, duration: 6 }],
    ]);
  });

  it("block range: only overlapping material, times relative to block start", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: withTracks({ mic: { fadeOutMs: 2000 } }),
      sources: {
        mic: fakeBuffer(60),
        regions: { music: fakeBuffer(100) },
        clickSound: fakeBuffer(0.1),
      },
      regions: [region({ startMs: 25_000, endMs: 40_000 })],
      clickEvents: [{ tMs: 10_000 }, { tMs: 29_950 }, { tMs: 45_000 }],
      range: { startMs: 30_000, endMs: 60_000 },
    });
    const srcs = ctx.bufferSources();
    const mic = srcs.filter((s) => s.outputs[0] === g.tracks.mic);
    expect(mic.map((s) => s.starts[0])).toEqual([{ when: 0, offset: 30, duration: 30 }]);
    const music = srcs.filter((s) => s.outputs[0] === g.regions.music);
    expect(music[0]?.starts[0]?.when).toBe(0);
    expect(music[0]?.starts[0]?.offset).toBeCloseTo(5, 9);
    expect(music[0]?.starts[0]?.duration).toBeCloseTo(10, 9);
    const clicks = srcs.filter((s) => s.outputs[0] === (g.clicks as unknown as FakeNode));
    // 29 950 click tail (50ms) spills into this block; 45 000 lands at 15s.
    expect(clicks.map((c) => c.starts[0])).toEqual([
      { when: 0, offset: expect.closeTo(0.05, 9), duration: expect.closeTo(0.05, 9) },
      { when: 15, offset: 0, duration: expect.closeTo(0.1, 9) },
    ]);
    // Mic fade-out curve spans the block and ends silent at 60s.
    const ev = (
      g.tracks.mic?.gain as unknown as {
        events: Array<{ type: string; values: Float32Array; time: number }>;
      }
    ).events[0];
    expect(ev?.type).toBe("curve");
    expect(ev?.time).toBe(0);
    expect(ev?.values[ev.values.length - 1]).toBe(0);
    expect(ev?.values[0]).toBe(1);
  });

  it("ducking lowers region gain while the mic is active", () => {
    const ctx = createFakeContext();
    // 10 Hz envelope: voice active 1.0s–2.0s.
    const envelopeDb = Array.from({ length: 50 }, (_, i) => (i >= 10 && i < 20 ? -10 : -90));
    const g = buildAudioGraph({
      ctx,
      settings: S,
      sources: { mic: fakeBuffer(5), regions: { music: fakeBuffer(5) } },
      regions: [region({ startMs: 0, endMs: 5000, duck: { enabled: true, amountDb: 12 } })],
      micEnvelope: { envelopeDb, sampleRateHz: 10 },
      automationStepMs: 100,
    });
    const ev = (g.regions.music?.gain as unknown as { events: Array<{ values: Float32Array }> })
      .events[0];
    const v = ev?.values ?? new Float32Array();
    expect(v[5]).toBe(1); // 0.5s
    expect(v[15]).toBeCloseTo(10 ** (-12 / 20), 5); // 1.5s: fully ducked
    expect(v[45]).toBe(1); // 4.5s: released
  });

  it("startAtS offsets every scheduled time (live preview context)", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({
      ctx,
      settings: withTracks({ mic: { fadeInMs: 1000 } }),
      sources: { mic: fakeBuffer(10), clickSound: fakeBuffer(0.1) },
      clickEvents: [{ tMs: 5000 }],
      range: { startMs: 2000, endMs: 10_000 },
      startAtS: 100,
    });
    const starts = ctx.bufferSources().map((s) => s.starts[0]);
    expect(starts).toEqual([
      { when: 100, offset: 2, duration: 8 },
      { when: 103, offset: 0, duration: expect.closeTo(0.1, 9) },
    ]);
    const masterEv = (g.master.gain as unknown as { events: Array<{ time: number }> }).events;
    expect(masterEv[0]?.time).toBe(100);
    const micEv = (g.tracks.mic?.gain as unknown as { events: Array<{ time: number }> }).events;
    expect(micEv[0]?.time).toBe(100);
  });

  it("no sources at all → master chain only", () => {
    const ctx = createFakeContext();
    const g = buildAudioGraph({ ctx, settings: S, sources: {} });
    expect(ctx.bufferSources()).toHaveLength(0);
    expect(g.clicks).toBeNull();
    expect(g.outputDurationMs).toBe(0);
  });
});
