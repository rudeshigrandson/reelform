import { describe, expect, it, vi } from "vitest";
import { bufferBlockSource } from "../../export/engine/audio";
import type { ExportProgress } from "../../export/engine/progress";
import { StreamingDecoder } from "../../export/engine/streamingDecoder";
import {
  FakeMuxer,
  FakePacketSource,
  FakeRenderer,
  FakeVideoDecoder,
  FrameLedger,
  createFakeWebCodecs,
  fakeAudioBuffer,
} from "../../export/engine/testFakes";
import type { FakeWebCodecsOptions } from "../../export/engine/testFakes";
import type { VideoRouteArgs } from "./runner";
import { FakeFlowSink, sceneInputFor } from "./testFakes";
import type { RenderAudioArgs } from "./videoRoute";
import { createVideoRoute } from "./videoRoute";

function setup(wc: FakeWebCodecsOptions = {}, withAudio = true) {
  const ledger = new FrameLedger();
  const fake = createFakeWebCodecs(ledger, wc);
  const renderer = new FakeRenderer(ledger);
  const destroy = vi.spyOn(renderer, "destroy");
  const muxers: FakeMuxer[] = [];
  const audioCalls: RenderAudioArgs[] = [];
  let clock = 0;
  const route = createVideoRoute({
    timeline: {
      clips: [{ id: "c1", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0 }],
      speeds: [{ startMs: 1000, endMs: 2000, rate: 2 }],
      sourceFps: 30,
      sceneInput: sceneInputFor,
    },
    videoUrl: "reelform-media://root/video.mp4",
    renderAudio: async (a) => {
      audioCalls.push(a);
      return withAudio
        ? bufferBlockSource(fakeAudioBuffer(Math.round((a.outputDurationMs * 48_000) / 1000)))
        : null;
    },
    now: () => {
      clock += 2;
      return clock;
    },
    webcodecs: () => fake.api,
    openFrameSource: async () =>
      new StreamingDecoder({
        source: new FakePacketSource(120, 30, 30),
        createDecoder: (init) => new FakeVideoDecoder(init, ledger),
      }),
    createRenderer: async () => renderer,
    createMuxer: (opts, sink) => {
      const m = new FakeMuxer(opts, sink);
      muxers.push(m);
      return m;
    },
  });
  return { route, fake, renderer, destroy, muxers, audioCalls };
}

const args = (
  sink: FakeFlowSink,
  patch: Partial<VideoRouteArgs> = {},
  progress: ExportProgress[] = [],
): VideoRouteArgs => ({
  config: { codec: "h264", container: "mp4", width: 640, height: 360, fps: 30, quality: "High" },
  range: { startMs: 0, endMs: 3000 },
  preferHardware: true,
  includeAudio: true,
  burnInCaptions: false,
  sink,
  signal: new AbortController().signal,
  onProgress: (p) => progress.push(p),
  ...patch,
});

describe("video route wiring", () => {
  it("renders audio for the frame plan's output duration and runs the engine into the sink", async () => {
    const t = setup();
    const sink = new FakeFlowSink("/exports/Demo.mp4");
    const progress: ExportProgress[] = [];
    const res = await t.route(args(sink, {}, progress));
    // 3000ms timeline with a 2× second → 2500ms output.
    expect(t.audioCalls).toHaveLength(1);
    expect(t.audioCalls[0]?.outputDurationMs).toBeCloseTo(2500, 6);
    expect(res).toMatchObject({ path: "/exports/Demo.mp4", encoder: "hardware", attempts: 1 });
    expect(res.pcmAudio).toBeNull();
    expect(sink.events).toEqual(["begin", "finish"]);
    expect(t.muxers[0]?.opts.audio).toMatchObject({ codec: "aac", numberOfChannels: 2 });
    expect(t.muxers[0]?.video).toHaveLength(75);
    expect(progress.at(-1)?.phase).toBe("finalizing");
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it("muted exports skip the audio render; software preference probes software only", async () => {
    const t = setup();
    const sink = new FakeFlowSink();
    const res = await t.route(args(sink, { includeAudio: false, preferHardware: false }));
    expect(t.audioCalls).toEqual([]);
    expect(t.muxers[0]?.opts.audio).toBeNull();
    expect(res.encoder).toBe("software");
    expect(t.fake.probed.every((c) => c.hardwareAcceleration === "prefer-software")).toBe(true);
  });

  it("returns the PCM WAV fallback when AAC is unavailable", async () => {
    const t = setup({ aacSupported: false });
    const res = await t.route(args(new FakeFlowSink()));
    expect(res.pcmAudio?.length).toBe(Math.round((2500 * 48_000) / 1000));
    expect(t.muxers[0]?.opts.audio).toBeNull();
  });

  it("composes the scene with the output fps and the burn-in choice, after prepare", async () => {
    const order: string[] = [];
    const sceneInput = vi.fn((size: { width: number; height: number }) => {
      order.push("scene");
      return sceneInputFor(size);
    });
    const ledger = new FrameLedger();
    const fake = createFakeWebCodecs(ledger, {});
    const route = createVideoRoute({
      timeline: {
        clips: [{ id: "c1", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0 }],
        speeds: [],
        sourceFps: 30,
        sceneInput,
        prepare: async () => {
          order.push("prepare");
        },
      },
      videoUrl: "x",
      renderAudio: async () => null,
      now: () => 0,
      webcodecs: () => fake.api,
      openFrameSource: async () =>
        new StreamingDecoder({
          source: new FakePacketSource(30, 30, 30),
          createDecoder: (init) => new FakeVideoDecoder(init, ledger),
        }),
      createRenderer: async () => new FakeRenderer(ledger),
      createMuxer: (opts, sink) => new FakeMuxer(opts, sink),
    });
    await route(
      args(new FakeFlowSink(), { burnInCaptions: true, range: { startMs: 0, endMs: 1000 } }),
    );
    expect(sceneInput).toHaveBeenCalledWith(
      { width: 640, height: 360 },
      { fps: 30, burnInCaptions: true },
    );
    expect(order[0]).toBe("prepare");
  });

  it("destroys the renderer when the engine fails", async () => {
    const t = setup({ hwSupported: false, swSupported: false });
    const sink = new FakeFlowSink();
    await expect(t.route(args(sink))).rejects.toThrow();
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });
});
