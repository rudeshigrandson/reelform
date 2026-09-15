import { describe, expect, it, vi } from "vitest";
import { initialEditorData } from "../store";
import {
  type FakeContext,
  type FakeSource,
  createFakeContext,
  fakeBuffer,
} from "./fakeAudioContext";
import type { AudioBufferLike, ProcessorFactory } from "./graph";
import {
  type LiveAudioContextLike,
  type PreviewAudioArgs,
  type PreviewAudioPlayerDeps,
  createPreviewAudioPlayer,
  shuttleSpeeds,
} from "./previewPlayer";

const BASE = "reelform-media://root/";

type LiveFake = FakeContext &
  LiveAudioContextLike & { currentTime: number; resumed: number; closed: boolean };

function liveContext(durations: Record<string, number>): LiveFake {
  const base = createFakeContext(48_000);
  const live = base as LiveFake;
  live.currentTime = 10;
  live.resumed = 0;
  live.closed = false;
  live.resume = async () => {
    live.resumed++;
  };
  live.close = async () => {
    live.closed = true;
  };
  live.decodeAudioData = async (bytes: ArrayBuffer): Promise<AudioBufferLike> => {
    const url = new TextDecoder().decode(bytes);
    if (url.includes("broken")) throw new Error("bad data");
    return fakeBuffer(durations[url] ?? 60);
  };
  return live;
}

function harness(
  durations: Record<string, number> = {},
  extra: Partial<PreviewAudioPlayerDeps> = {},
) {
  const contexts: LiveFake[] = [];
  const fetched: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const player = createPreviewAudioPlayer({
    createContext: () => {
      const c = liveContext(durations);
      contexts.push(c);
      return c;
    },
    fetchBytes: async (url) => {
      fetched.push(url);
      return new TextEncoder().encode(url).buffer as ArrayBuffer;
    },
    leadS: 0.05,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (h) => {
      (h as unknown as { cleared: boolean }).cleared = true;
    },
    ...extra,
  });
  const ctx = () => contexts[0] as LiveFake;
  const flushTimers = () => {
    for (const t of timers.splice(0)) if (!t.cleared) t.fn();
  };
  const liveSources = (): FakeSource[] =>
    (player.graph()?.sources ?? []) as unknown as FakeSource[];
  return { player, contexts, ctx, fetched, timers, flushTimers, liveSources };
}

function args(patch: Partial<PreviewAudioArgs> = {}): PreviewAudioArgs {
  return {
    micUrl: "mic.m4a",
    systemAudioUrl: null,
    mediaBaseUrl: BASE,
    audio: initialEditorData().audio,
    clickSound: { type: "none", volume: 60, customSound: null },
    telemetry: null,
    clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 60_000, timelineStartMs: 0 }],
    speeds: [],
    durationMs: 60_000,
    ...patch,
  };
}

const playing = (currentMs: number, rate = 1) => ({ isPlaying: true, currentMs, rate });
const paused = (currentMs: number) => ({ isPlaying: false, currentMs, rate: 1 });

describe("preview audio player", () => {
  it("decodes once per URL and schedules from the playhead on play", async () => {
    const h = harness();
    h.player.setArgs(args());
    h.player.setArgs(args());
    await h.player.idle();
    expect(h.fetched).toEqual(["mic.m4a"]);
    expect(h.contexts).toHaveLength(1);

    h.player.sync(playing(2000));
    const [src] = h.liveSources();
    expect(src?.starts[0]?.when).toBeCloseTo(10.05, 6);
    expect(src?.starts[0]?.offset).toBeCloseTo(2, 6);
    expect(src?.starts[0]?.duration).toBeCloseTo(58, 6);
    expect(h.ctx().resumed).toBe(1);
  });

  it("pause stops every scheduled source and detaches the graph", async () => {
    const h = harness();
    h.player.setArgs(args());
    await h.player.idle();
    h.player.sync(playing(0));
    const sources = h.liveSources();
    const limiter = h.player.graph()?.limiter as unknown as { outputs: unknown[] };
    expect(limiter.outputs).toHaveLength(1);
    h.player.sync(paused(500));
    expect(h.player.graph()).toBeNull();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(limiter.outputs).toHaveLength(0);
  });

  it("a seek (or loop wrap) while playing rebuilds; normal progress does not", async () => {
    const h = harness();
    h.player.setArgs(args());
    await h.player.idle();
    h.player.sync(playing(1000));
    const first = h.player.graph();
    h.ctx().currentTime += 0.5;
    h.player.sync(playing(1540));
    expect(h.player.graph()).toBe(first);
    h.player.sync(playing(30_000));
    expect(h.player.graph()).not.toBe(first);
    expect((first?.sources[0] as unknown as FakeSource).stopped).toBe(true);
    expect(h.liveSources()[0]?.starts[0]?.offset).toBeCloseTo(30, 6);
  });

  it("settings changes rebuild after a debounce, only while playing", async () => {
    const h = harness();
    h.player.setArgs(args());
    await h.player.idle();
    h.flushTimers();
    h.player.sync(playing(0));
    const first = h.player.graph();
    const audio = initialEditorData().audio;
    audio.master.volumeDb = -6;
    h.player.setArgs(args({ audio }));
    h.player.setArgs(args({ audio }));
    expect(h.player.graph()).toBe(first);
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);
    expect(h.timers[0]?.ms).toBe(120);
    h.flushTimers();
    expect(h.player.graph()).not.toBe(first);
    expect(h.player.graph()?.master.gain.value).toBeCloseTo(10 ** (-6 / 20), 6);

    h.player.sync(paused(0));
    h.player.setArgs(args({ audio: initialEditorData().audio }));
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
  });

  it("structurally equal clips / speeds / click sound from a re-render don't rebuild", async () => {
    const h = harness();
    // The document's audio settings keep their reference between renders.
    const audio = initialEditorData().audio;
    h.player.setArgs(args({ audio }));
    await h.player.idle();
    h.flushTimers();
    h.player.sync(playing(0));
    const first = h.player.graph();
    for (let i = 0; i < 3; i++) {
      h.player.setArgs(
        args({
          audio,
          clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 60_000, timelineStartMs: 0 }],
          speeds: [],
          clickSound: { type: "none", volume: 60, customSound: null },
        }),
      );
    }
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
    expect(h.player.graph()).toBe(first);
    h.player.setArgs(
      args({
        audio,
        clips: [{ id: "c", sourceStartMs: 1000, sourceEndMs: 60_000, timelineStartMs: 0 }],
      }),
    );
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);
  });

  it("shuttle rate changes are debounced and play the track faster", async () => {
    const h = harness();
    h.player.setArgs(args());
    await h.player.idle();
    h.player.sync(playing(0));
    h.player.sync(playing(0, 2));
    expect(h.liveSources()[0]?.playbackRate.value).toBe(1);
    h.flushTimers();
    expect(h.liveSources()[0]?.playbackRate.value).toBe(2);
  });

  it("schedules click sounds from telemetry through the selected pack", async () => {
    const h = harness({ "/sounds/mechanical/click.wav": 0.08 });
    h.player.setArgs(
      args({
        micUrl: null,
        clickSound: { type: "mechanical", volume: 60, customSound: null },
        telemetry: {
          clicks: [
            [4000, 0, 0, "left", "down"],
            [4100, 0, 0, "left", "up"],
            [9000, 0, 0, "left", "down"],
          ],
        },
        clips: [{ id: "c", sourceStartMs: 3000, sourceEndMs: 63_000, timelineStartMs: 0 }],
      }),
    );
    await h.player.idle();
    expect(h.fetched).toEqual(["/sounds/mechanical/click.wav"]);
    h.player.sync(playing(2000));
    // Source 4000 → timeline 1000 (already past), source 9000 → timeline 6000.
    const clicks = h.liveSources();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.starts[0]?.when).toBeCloseTo(10.05 + 4, 6);
    expect(h.player.graph()?.clicks?.gain.value).toBeCloseTo(0.6, 6);
  });

  it("decodes regions through the media base and rebuilds when a decode lands mid-play", async () => {
    const h = harness({ [`${BASE}media/song.mp3`]: 30 });
    const audio = initialEditorData().audio;
    audio.regions = [
      {
        id: "r1",
        fileName: "song.mp3",
        path: "media/song.mp3",
        startMs: 5000,
        endMs: 20_000,
        volumeDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        loop: false,
        duck: { enabled: true, amountDb: 12 },
      },
    ];
    h.player.setArgs(args({ micUrl: null, audio }));
    h.player.sync(playing(0));
    expect(h.player.graph()).toBeNull();
    await h.player.idle();
    h.flushTimers();
    const [src] = h.liveSources();
    expect(src?.buffer?.duration).toBe(30);
    expect(src?.starts[0]?.when).toBeCloseTo(15.05, 6);
  });

  it("passes loudness and the noise reduction processor when enabled", async () => {
    let slots = 0;
    const nr: ProcessorFactory = (ctx) => {
      slots++;
      const g = ctx.createGain();
      return { input: g, output: g };
    };
    const h = harness({}, { noiseReduction: nr });
    const audio = initialEditorData().audio;
    audio.tracks.mic.noiseReduction = true;
    audio.tracks.mic.normalize = true;
    h.player.setArgs(args({ audio }));
    h.player.setLoudness({ mic: -20 });
    await h.player.idle();
    h.flushTimers();
    h.player.sync(playing(0));
    expect(slots).toBe(1);
    const gains = h
      .ctx()
      .gains()
      .map((g) => g.gain.value);
    expect(gains.some((v) => Math.abs(v - 10 ** (4 / 20)) < 1e-6)).toBe(true);

    h.player.setLoudness({ mic: -20 });
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
    h.player.setLoudness({ mic: -18 });
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);
  });

  it("prepares a worklet-backed noise reduction once, then rebuilds with it", async () => {
    let ready = false;
    let resolvePrepare: (ok: boolean) => void = () => undefined;
    const prepare = (): Promise<boolean> =>
      new Promise((res) => {
        resolvePrepare = (ok) => {
          ready = ok;
          res(ok);
        };
      });
    const nodes: string[] = [];
    const nr = Object.assign(
      (ctx: Parameters<ProcessorFactory>[0]) => {
        nodes.push(ready ? "worklet" : "passthrough");
        const g = ctx.createGain();
        return { input: g, output: g };
      },
      { prepare: vi.fn(prepare) },
    );
    const h = harness({}, { noiseReduction: nr });
    const audio = initialEditorData().audio;
    audio.tracks.mic.noiseReduction = true;
    h.player.setArgs(args({ audio }));
    await h.player.idle();
    h.flushTimers();
    h.player.sync(playing(0));
    expect(nodes).toEqual(["passthrough"]);
    h.player.sync(playing(5000));
    expect(nr.prepare).toHaveBeenCalledTimes(1);
    resolvePrepare(true);
    await Promise.resolve();
    await Promise.resolve();
    h.flushTimers();
    expect(nodes.at(-1)).toBe("worklet");
  });

  it("undecodable media stays silent without retrying", async () => {
    const h = harness();
    h.player.setArgs(args({ micUrl: "broken.m4a" }));
    await h.player.idle();
    h.player.setArgs(args({ micUrl: "broken.m4a", durationMs: 50_000 }));
    await h.player.idle();
    expect(h.fetched).toEqual(["broken.m4a"]);
    h.player.sync(playing(0));
    expect(h.player.graph()).toBeNull();
  });

  it("dispose stops playback and closes the context", async () => {
    const h = harness();
    h.player.setArgs(args());
    await h.player.idle();
    h.player.sync(playing(0));
    const sources = h.liveSources();
    h.player.dispose();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(h.ctx().closed).toBe(true);
    h.player.sync(playing(0));
    expect(h.player.graph()).toBeNull();
  });
});

describe("shuttleSpeeds", () => {
  it("scales regions and fills gaps with the shuttle factor", () => {
    expect(shuttleSpeeds([{ startMs: 1000, endMs: 2000, rate: 2 }], 1, 5000)).toEqual([
      { startMs: 1000, endMs: 2000, rate: 2 },
    ]);
    expect(
      shuttleSpeeds(
        [
          { startMs: 1000, endMs: 2000, rate: 2, rampInMs: 100 },
          { startMs: 1500, endMs: 3000, rate: 0.5 },
        ],
        4,
        5000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 1000, rate: 4 },
      { startMs: 1000, endMs: 2000, rate: 8, rampInMs: 100 },
      { startMs: 2000, endMs: 3000, rate: 2 },
      { startMs: 3000, endMs: 5000, rate: 4 },
    ]);
  });
});
