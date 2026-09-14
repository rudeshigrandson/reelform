import { describe, expect, it } from "vitest";
import type { Clip } from "../../editor/model/schema";
import type { RateRegion } from "../../editor/playback/clock";
import type { ExportConfig } from "../route";
import type { AudioBufferLike } from "./audio";
import { BT709_LIMITED, ExportConfigError } from "./encoderConfig";
import {
  EncoderFailure,
  type ExportEngineDeps,
  type ExportJob,
  MAX_ENCODE_QUEUE,
  runExport,
} from "./engine";
import type { ExportProgress } from "./progress";
import { type FrameSource, MAX_HELD_FRAMES, StreamingDecoder } from "./streamingDecoder";
import {
  FakeMuxer,
  FakePacketSource,
  FakeRenderer,
  FakeSink,
  FakeVideoDecoder,
  type FakeWebCodecsOptions,
  FrameLedger,
  createFakeWebCodecs,
  fakeAudioBuffer,
  fakeScene,
} from "./testFakes";

const settle = () => new Promise((r) => setTimeout(r, 10));

interface SetupOptions {
  durationMs?: number;
  fps?: number;
  codec?: ExportConfig["codec"];
  container?: ExportConfig["container"];
  wc?: FakeWebCodecsOptions;
  speeds?: RateRegion[];
  audio?: AudioBufferLike | null;
  preferHardware?: boolean;
  visible?: boolean;
  sink?: FakeSink;
}

function setup(o: SetupOptions = {}) {
  const durationMs = o.durationMs ?? 3000;
  const fps = o.fps ?? 30;
  const ledger = new FrameLedger();
  const fake = createFakeWebCodecs(ledger, o.wc);
  const source = new FakePacketSource(Math.ceil((durationMs * 30) / 1000), 30, 30);
  const decoders: FakeVideoDecoder[] = [];
  const frameSources: StreamingDecoder[] = [];
  const sink = o.sink ?? new FakeSink();
  const muxers: FakeMuxer[] = [];
  const renderer = new FakeRenderer(ledger);
  const progress: ExportProgress[] = [];
  let clock = 0;
  const deps: ExportEngineDeps = {
    webcodecs: fake.api,
    openFrameSource: async () => {
      const d = new StreamingDecoder({
        source,
        createDecoder: (init) => {
          const raw = new FakeVideoDecoder(init, ledger);
          decoders.push(raw);
          return raw;
        },
      });
      frameSources.push(d);
      return d;
    },
    renderer,
    createMuxer: (opts, s) => {
      const m = new FakeMuxer(opts, s);
      muxers.push(m);
      return m;
    },
    sink,
    now: () => {
      clock += 5;
      return clock;
    },
  };
  const clip: Clip = { id: "c", sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0 };
  const job: ExportJob = {
    config: {
      codec: o.codec ?? "h264",
      container: o.container ?? "mp4",
      width: 1280,
      height: 720,
      fps,
      quality: "High",
    },
    timeline: { clips: [clip], speeds: o.speeds, sourceFps: 30 },
    sceneAt: (ms) => fakeScene(ms, o.visible ?? true),
    audio: o.audio ?? null,
    preferHardware: o.preferHardware ?? true,
  };
  const phases = () => progress.map((p) => p.phase).filter((p, i, a) => i === 0 || a[i - 1] !== p);
  return {
    ledger,
    fake,
    source,
    decoders,
    frameSources,
    sink,
    muxers,
    renderer,
    progress,
    deps,
    job,
    phases,
  };
}

describe("runExport — happy path", () => {
  it("encodes every frame with µs timestamps, keyframes every 2 s, and streams through the muxer", async () => {
    const h = setup();
    let progressAheadOfEncoder = false;
    const result = await runExport(h.job, h.deps, {
      onProgress: (p) => {
        h.progress.push(p);
        // §10.7: progress = frames ENCODED, never merely submitted.
        if (p.framesDone > (h.fake.videoEncoders[0]?.outputs ?? 0)) progressAheadOfEncoder = true;
      },
    });
    expect(progressAheadOfEncoder).toBe(false);
    expect(result).toEqual({
      path: "/tmp/out.mp4",
      encoder: "hardware",
      attempts: 1,
      framesEncoded: 90,
      audio: "none",
      pcmWav: null,
    });
    const enc = h.fake.videoEncoders[0];
    expect(h.fake.videoEncoders).toHaveLength(1);
    expect(enc?.encoded.map((e) => e.timestamp)).toEqual(
      Array.from({ length: 90 }, (_, i) => Math.round((i * 1e6) / 30)),
    );
    expect(enc?.encoded.every((e) => e.duration === 33_333)).toBe(true);
    expect(enc?.encoded.flatMap((e, i) => (e.keyFrame ? [i] : []))).toEqual([0, 60]);
    expect(enc?.config).toMatchObject({
      latencyMode: "quality",
      hardwareAcceleration: "prefer-hardware",
    });
    expect(enc?.maxQueueAtEncode).toBeLessThanOrEqual(MAX_ENCODE_QUEUE);

    const mux = h.muxers[0] as FakeMuxer;
    expect(mux.video.map((v) => v.timestamp)).toEqual(enc?.encoded.map((e) => e.timestamp));
    expect(mux.video[0]?.meta?.decoderConfig).toBeDefined();
    expect(mux.finalized).toBe(true);
    expect(mux.opts).toMatchObject({
      maximumVideoPackets: 90,
      audio: null,
      colorSpace: BT709_LIMITED,
    });
    expect(h.sink.events).toEqual(["begin", "finish"]);
    expect(h.sink.infos[0]).toMatchObject({ container: "mp4", codec: "h264", encoder: "hardware" });

    expect(h.renderer.calls.map((c) => c.sourceTimestamp)).toEqual(
      h.source.packets.map((p) => p.timestampUs),
    );
    expect(h.phases()).toEqual(["preparing", "rendering", "muxing", "finalizing"]);
    expect(h.progress.at(-1)).toMatchObject({ framesDone: 90, framesTotal: 90, fraction: 1 });

    await settle();
    expect(h.ledger.live).toBe(0);
    expect(h.ledger.doubleClose).toBe(0);
    expect(h.ledger.maxLive).toBeLessThanOrEqual(MAX_HELD_FRAMES);
    expect(h.decoders[0]?.state).toBe("closed");
  });

  it("speed < 1 repeats source frames; output timestamps stay on the output grid", async () => {
    const h = setup({ speeds: [{ startMs: 0, endMs: 3000, rate: 0.5 }] });
    const result = await runExport(h.job, h.deps);
    expect(result.framesEncoded).toBe(180);
    const src = h.renderer.calls.map((c) => c.sourceTimestamp as number);
    const counts = new Map<number, number>();
    for (const s of src) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(89);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    expect(h.fake.videoEncoders[0]?.encoded[179]?.timestamp).toBe(Math.round((179 * 1e6) / 30));
    await settle();
    expect(h.ledger.live).toBe(0);
  });

  it("frames with the video hidden never open the decoder", async () => {
    const h = setup({ visible: false, durationMs: 500 });
    await runExport(h.job, h.deps);
    expect(h.frameSources).toHaveLength(0);
    expect(h.renderer.calls.every((c) => c.sourceTimestamp === null)).toBe(true);
  });
});

describe("runExport — software fallback", () => {
  it("hardware rejected at probe → software in the same attempt", async () => {
    const h = setup({ wc: { hwSupported: false } });
    const result = await runExport(h.job, h.deps, { onProgress: (p) => h.progress.push(p) });
    expect(result).toMatchObject({ encoder: "software", attempts: 1 });
    expect(h.fake.videoEncoders[0]?.config?.hardwareAcceleration).toBe("prefer-software");
    expect(h.sink.events).toEqual(["begin", "finish"]);
    expect(h.sink.infos[0]?.encoder).toBe("software");
    expect(h.progress.at(-1)?.encoder).toBe("software");
  });

  it("hardware configure() rejection restarts the export on software", async () => {
    const h = setup({
      wc: { encoder: { configureThrows: (c) => c.hardwareAcceleration === "prefer-hardware" } },
    });
    const result = await runExport(h.job, h.deps);
    expect(result).toMatchObject({ encoder: "software", attempts: 2, framesEncoded: 90 });
    expect(h.sink.events).toEqual(["begin", "cancel", "begin", "finish"]);
    expect(h.muxers[0]?.cancelled).toBe(true);
    expect(h.muxers[1]?.video).toHaveLength(90);
  });

  it("hardware error mid-export restarts the whole export on software without leaks", async () => {
    const h = setup({
      wc: {
        encoder: {
          failAfterOutputs: (c) => (c.hardwareAcceleration === "prefer-hardware" ? 10 : null),
        },
      },
    });
    const result = await runExport(h.job, h.deps);
    expect(result).toMatchObject({ encoder: "software", attempts: 2, framesEncoded: 90 });
    expect(h.sink.events).toEqual(["begin", "cancel", "begin", "finish"]);
    expect(h.muxers[0]?.cancelled).toBe(true);
    expect(h.muxers[1]?.video.map((v) => v.timestamp)[0]).toBe(0);
    expect(h.muxers[1]?.video).toHaveLength(90);
    expect(h.frameSources).toHaveLength(2);
    await settle();
    expect(h.ledger.live).toBe(0);
    expect(h.decoders.every((d) => d.state === "closed")).toBe(true);
  });

  it("a software encoder failure is not retried", async () => {
    const h = setup({ preferHardware: false, wc: { encoder: { failAfterOutputs: () => 5 } } });
    const err = await runExport(h.job, h.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EncoderFailure);
    expect((err as EncoderFailure).encoder).toBe("software");
    expect(h.sink.events).toEqual(["begin", "cancel"]);
    expect(h.fake.probed.map((c) => c.hardwareAcceleration)).toEqual(["prefer-software"]);
    await settle();
    expect(h.ledger.live).toBe(0);
  });

  it("non-encoder failures (decode, sink) are not retried", async () => {
    const h = setup();
    h.deps.openFrameSource = async (): Promise<FrameSource> => ({
      frameAt: () => Promise.reject(new Error("source unreadable")),
      close: () => undefined,
    });
    await expect(runExport(h.job, h.deps)).rejects.toThrow("source unreadable");
    expect(h.sink.events).toEqual(["begin", "cancel"]);

    class FailingSink extends FakeSink {
      override async writeChunk(): Promise<void> {
        throw new Error("disk full");
      }
    }
    const s = setup({ sink: new FailingSink() });
    await expect(runExport(s.job, s.deps)).rejects.toThrow("disk full");
    expect(s.sink.events).toEqual(["begin", "cancel"]);
    await settle();
    expect(s.ledger.live).toBe(0);
  });
});

describe("runExport — cancel", () => {
  it("abort mid-render closes decoder + encoder, cancels muxer and sink, leaks nothing", async () => {
    const h = setup();
    const ac = new AbortController();
    h.renderer.onRender = (n) => {
      if (n === 20) ac.abort();
    };
    const err = await runExport(h.job, h.deps, { signal: ac.signal }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(h.sink.events).toEqual(["begin", "cancel"]);
    expect(h.muxers[0]?.cancelled).toBe(true);
    expect(h.fake.videoEncoders[0]?.state).toBe("closed");
    expect(h.decoders[0]?.state).toBe("closed");
    expect(h.fake.videoEncoders).toHaveLength(1);
    await settle();
    expect(h.ledger.live).toBe(0);
  });

  it("abort while encoding audio stops it and cancels the sink", async () => {
    const h = setup({ durationMs: 200, audio: fakeAudioBuffer(48_000 * 20) });
    const ac = new AbortController();
    const p = runExport(h.job, h.deps, {
      signal: ac.signal,
      onProgress: (e) => {
        if (e.phase === "encoding-audio") setTimeout(() => ac.abort(), 0);
      },
    });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(h.sink.events).toEqual(["begin", "cancel"]);
    expect(h.fake.audioEncoders[0]?.state).toBe("closed");
    expect(h.fake.audioDataCounter.live).toBe(0);
  });

  it("an already-aborted signal never begins", async () => {
    const h = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(runExport(h.job, h.deps, { signal: ac.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(h.sink.events).toEqual([]);
  });
});

describe("runExport — audio and validation", () => {
  it("AAC audio is encoded before video (so the muxer never buffers the whole video) and muxed", async () => {
    const h = setup({ audio: fakeAudioBuffer(48_000 * 3) });
    const result = await runExport(h.job, h.deps, { onProgress: (p) => h.progress.push(p) });
    expect(result.audio).toBe("aac");
    expect(h.phases()).toEqual([
      "preparing",
      "encoding-audio",
      "rendering",
      "muxing",
      "finalizing",
    ]);
    const order = h.muxers[0]?.order ?? [];
    expect(order.lastIndexOf("audio")).toBeLessThan(order.indexOf("video"));
    expect(order.filter((o) => o === "video")).toHaveLength(90);
    expect(h.muxers[0]?.opts.audio).toEqual({
      codec: "aac",
      sampleRate: 48_000,
      numberOfChannels: 2,
    });
    expect(h.muxers[0]?.audio).toEqual([0, 1_000_000, 2_000_000]);
    expect(h.fake.audioDataCounter.live).toBe(0);
  });

  it("WebM without Opus falls back to PCM WAV for ffmpeg finalize", async () => {
    const h = setup({
      codec: "vp9",
      container: "webm",
      audio: fakeAudioBuffer(1000),
      wc: { opusSupported: false },
    });
    const result = await runExport(h.job, h.deps);
    expect(result.audio).toBe("pcm-wav");
    expect(result.pcmWav?.byteLength).toBe(44 + 1000 * 4);
    expect(h.muxers[0]?.opts.audio).toBeNull();
    expect(h.fake.audioEncoders).toHaveLength(0);
  });

  it("invalid configs and empty ranges fail before touching the sink", async () => {
    const h = setup({ container: "webm", codec: "h264" });
    await expect(runExport(h.job, h.deps)).rejects.toBeInstanceOf(ExportConfigError);
    const e = setup();
    e.job.timeline = { clips: [] };
    await expect(runExport(e.job, e.deps)).rejects.toBeInstanceOf(ExportConfigError);
    const n = setup({ wc: { hwSupported: false, swSupported: false } });
    await expect(runExport(n.job, n.deps)).rejects.toMatchObject({
      name: "EncoderUnsupportedError",
    });
    expect([...h.sink.events, ...e.sink.events, ...n.sink.events]).toEqual([]);
  });
});
