import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip } from "../../editor/model/schema";
import type { RateRegion } from "../../editor/playback/clock";
import { webcamVisibleAt } from "../../editor/preview/layers/webcamLayer";
import type { SceneState } from "../../editor/preview/scene";
import { ExportCancelledError } from "./cancel";
import { type ExportEngineDeps, type ExportJob, runExport } from "./engine";
import { createFramePlan } from "./framePlan";
import {
  type FrameSource,
  MAX_HELD_FRAMES,
  SCREEN_DECODER_WINDOW_WITH_WEBCAM,
  StreamingDecoder,
  WEBCAM_DECODER_WINDOW,
} from "./streamingDecoder";
import {
  FakeMuxer,
  FakePacketSource,
  FakeRenderer,
  FakeSink,
  FakeVideoDecoder,
  type FakeWebCodecsOptions,
  FrameLedger,
  createFakeWebCodecs,
} from "./testFakes";
import { WEBCAM_UNAVAILABLE_NOTICE, webcamSourceMsFor } from "./webcamFeed";

const settle = () => new Promise((r) => setTimeout(r, 10));

interface Range {
  startMs: number;
  endMs: number;
}

/** Scene with a composed webcam layer whose visibility follows the regions. */
function webcamScene(tMs: number, regions: readonly Range[] = []): SceneState {
  return {
    tMs,
    video: { visible: true, crop: null },
    composition: { webcam: { visible: webcamVisibleAt(regions, tMs) } },
  } as unknown as SceneState;
}

/** Timestamp (µs) the StreamingDecoder hands out for `targetMs` over a CFR stream. */
function nearestFrameUs(frameCount: number, fps: number, targetMs: number): number {
  const ts = (i: number) => Math.round((i * 1_000_000) / fps);
  const target = Math.round(targetMs * 1000);
  let a = 0;
  for (let i = 0; i < frameCount && ts(i) <= target; i++) a = i;
  const b = a + 1 < frameCount ? a + 1 : null;
  if (ts(a) < target && b !== null && Math.abs(ts(b) - target) < target - ts(a)) return ts(b);
  return ts(a);
}

interface Options {
  durationMs?: number;
  fps?: number;
  speeds?: RateRegion[];
  clips?: Clip[];
  syncOffsetMs?: number;
  regions?: Range[];
  webcamFps?: number;
  webcamFrames?: number;
  openWebcam?: ((ledger: FrameLedger) => Promise<FrameSource>) | null;
  wc?: FakeWebCodecsOptions;
}

function harness(o: Options = {}) {
  const durationMs = o.durationMs ?? 1000;
  const ledger = new FrameLedger();
  const fake = createFakeWebCodecs(ledger, o.wc);
  const renderer = new FakeRenderer(ledger);
  const webcamFps = o.webcamFps ?? 24;
  const webcamFrames = o.webcamFrames ?? Math.ceil(((durationMs + 3000) * webcamFps) / 1000);
  const webcamPackets = new FakePacketSource(webcamFrames, webcamFps, webcamFps);
  const screen = new FakePacketSource(Math.ceil(((durationMs + 3000) * 30) / 1000), 30, 30);
  const opened = { screen: 0, webcam: 0 };
  const warnings: string[] = [];
  const deps: ExportEngineDeps = {
    webcodecs: fake.api,
    openFrameSource: async () => {
      opened.screen++;
      return new StreamingDecoder({
        source: screen,
        createDecoder: (init) => new FakeVideoDecoder(init, ledger),
        maxWindow: SCREEN_DECODER_WINDOW_WITH_WEBCAM,
      });
    },
    openWebcamSource: async () => {
      opened.webcam++;
      if (o.openWebcam) return o.openWebcam(ledger);
      return new StreamingDecoder({
        source: webcamPackets,
        createDecoder: (init) => new FakeVideoDecoder(init, ledger),
        maxWindow: WEBCAM_DECODER_WINDOW,
      });
    },
    renderer,
    createMuxer: (opts, s) => new FakeMuxer(opts, s),
    sink: new FakeSink(),
    now: () => 0,
  };
  const clips = o.clips ?? [
    { id: "c", sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0 },
  ];
  const timeline = { clips, speeds: o.speeds, sourceFps: 30 };
  const fps = o.fps ?? 30;
  const job: ExportJob = {
    config: { codec: "h264", container: "mp4", width: 640, height: 360, fps, quality: "High" },
    timeline,
    sceneAt: (ms) => webcamScene(ms, o.regions),
    audio: null,
    preferHardware: true,
    webcam: { syncOffsetMs: o.syncOffsetMs ?? 0 },
  };
  const plan = createFramePlan({ ...timeline, fps });
  const run = (signal?: AbortSignal) =>
    runExport(job, deps, { signal, onWarning: (m) => warnings.push(m) });
  return {
    ledger,
    renderer,
    fake,
    deps,
    job,
    plan,
    run,
    warnings,
    opened,
    webcamFrames,
    webcamFps,
  };
}

async function expectNoLeaks(ledger: FrameLedger): Promise<void> {
  await settle();
  expect(ledger.live).toBe(0);
  expect(ledger.doubleClose).toBe(0);
  expect(ledger.maxLive).toBeLessThanOrEqual(MAX_HELD_FRAMES);
}

describe("runExport — webcam bubble", () => {
  it("feeds the nearest webcam frame per output frame (sync offset + speed regions)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1500, max: 1500 }),
        fc.constantFrom(0.5, 1, 2),
        fc.constantFrom(10, 15, 24, 30),
        fc.constantFrom(24, 30),
        async (syncOffsetMs, rate, webcamFps, fps) => {
          const h = harness({
            syncOffsetMs,
            webcamFps,
            fps,
            speeds: [{ startMs: 200, endMs: 700, rate }],
          });
          await h.run();
          expect(h.renderer.calls).toHaveLength(h.plan.totalFrames);
          h.renderer.calls.forEach((call, i) => {
            const pf = h.plan.frameAt(i);
            const target = webcamSourceMsFor(pf.sourceMs, syncOffsetMs) as number;
            expect(call.webcamVisible).toBe(true);
            expect(call.webcamTimestamp).toBe(nearestFrameUs(h.webcamFrames, webcamFps, target));
          });
          // A lower webcam rate repeats frames (same timestamp on consecutive outputs).
          if (webcamFps < fps && rate === 1) {
            const stamps = h.renderer.calls.map((c) => c.webcamTimestamp);
            expect(new Set(stamps).size).toBeLessThan(stamps.length);
          }
          expect(h.warnings).toEqual([]);
          await expectNoLeaks(h.ledger);
        },
      ),
      { numRuns: 12 },
    );
  });

  it("keeps both decoders inside the 12-frame budget and closes every webcam frame", async () => {
    const h = harness({ durationMs: 3000, webcamFps: 30, syncOffsetMs: 400 });
    const res = await h.run();
    expect(res.framesEncoded).toBe(90);
    expect(h.opened).toEqual({ screen: 1, webcam: 1 });
    await expectNoLeaks(h.ledger);
    // Every webcam frame decoded was closed: live is 0 and the peak includes both windows.
    expect(h.ledger.maxLive).toBeGreaterThan(SCREEN_DECODER_WINDOW_WITH_WEBCAM);
  });

  it("honors visibility regions: decodes only while visible and detaches in between", async () => {
    const regions = [
      { startMs: 300, endMs: 500 },
      { startMs: 800, endMs: 900 },
    ];
    const h = harness({ regions });
    await h.run();
    for (const call of h.renderer.calls) {
      const visible = webcamVisibleAt(regions, call.tMs);
      expect(call.webcamVisible).toBe(visible);
      expect(call.webcamTimestamp === null).toBe(!visible);
    }
    expect(h.renderer.webcamSets.filter((s) => s === null)).toHaveLength(2);
    await expectNoLeaks(h.ledger);
  });

  it("never opens the webcam when no region is in range", async () => {
    const h = harness({ regions: [{ startMs: 5000, endMs: 6000 }] });
    await h.run();
    expect(h.opened.webcam).toBe(0);
    expect(h.renderer.calls.every((c) => !c.webcamVisible)).toBe(true);
  });

  it("a missing webcam file exports without the bubble and warns once", async () => {
    const h = harness({
      openWebcam: async () => {
        throw Object.assign(new Error("ENOENT: no such file webcam.webm"), { code: "ENOENT" });
      },
    });
    const res = await h.run();
    expect(res.framesEncoded).toBe(30);
    expect(h.renderer.calls.every((c) => !c.webcamVisible)).toBe(true);
    expect(h.warnings).toEqual([WEBCAM_UNAVAILABLE_NOTICE]);
    expect(h.opened.webcam).toBe(1);
    await expectNoLeaks(h.ledger);
  });

  it("a webcam with no decodable frames is treated as unavailable", async () => {
    const h = harness({ webcamFrames: 0 });
    const res = await h.run();
    expect(res.framesEncoded).toBe(30);
    expect(h.warnings).toEqual([WEBCAM_UNAVAILABLE_NOTICE]);
    await expectNoLeaks(h.ledger);
  });

  it("does not retry an unreadable webcam on the software restart", async () => {
    const h = harness({
      openWebcam: async () => {
        throw new Error("unreadable");
      },
      wc: {
        encoder: {
          failAfterOutputs: (c) => (c.hardwareAcceleration === "prefer-hardware" ? 5 : null),
        },
      },
    });
    const res = await h.run();
    expect(res.attempts).toBe(2);
    expect(h.opened.webcam).toBe(1);
    expect(h.warnings).toEqual([WEBCAM_UNAVAILABLE_NOTICE]);
    await expectNoLeaks(h.ledger);
  });

  it("reopens a healthy webcam per attempt", async () => {
    const h = harness({
      wc: {
        encoder: {
          failAfterOutputs: (c) => (c.hardwareAcceleration === "prefer-hardware" ? 5 : null),
        },
      },
    });
    const res = await h.run();
    expect(res.attempts).toBe(2);
    expect(h.opened.webcam).toBe(2);
    await expectNoLeaks(h.ledger);
  });

  it("cancel while the webcam decodes rejects as cancelled and leaks nothing", async () => {
    const ac = new AbortController();
    const h = harness({ durationMs: 2000 });
    h.renderer.onRender = (n) => {
      if (n === 10) ac.abort();
    };
    await expect(h.run(ac.signal)).rejects.toBeInstanceOf(ExportCancelledError);
    expect(h.warnings).toEqual([]);
    await expectNoLeaks(h.ledger);
  });

  it("without job.webcam a composed bubble is hidden, never drawn as a placeholder", async () => {
    const h = harness();
    await runExport({ ...h.job, webcam: null }, h.deps);
    expect(h.opened.webcam).toBe(0);
    expect(h.renderer.calls.every((c) => !c.webcamVisible)).toBe(true);
  });
});
