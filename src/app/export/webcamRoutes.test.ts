import { describe, expect, it } from "vitest";
import { webcamVisibleAt } from "../../editor/preview/layers/webcamLayer";
import { initialEditorData } from "../../editor/store";
import {
  MAX_HELD_FRAMES,
  SCREEN_DECODER_WINDOW_WITH_WEBCAM,
  StreamingDecoder,
  WEBCAM_DECODER_WINDOW,
} from "../../export/engine/streamingDecoder";
import {
  FakeMuxer,
  FakePacketSource,
  FakeRenderer,
  FakeVideoDecoder,
  FrameLedger,
  createFakeWebCodecs,
} from "../../export/engine/testFakes";
import { WEBCAM_UNAVAILABLE_NOTICE } from "../../export/engine/webcamFeed";
import type { GifWorkerLike } from "../../export/gif/client";
import { solidFrame } from "../../export/gif/testing/frames";
import { createGifWorkerHost } from "../../export/gif/workerHost";
import { createGifRoute } from "./gifRoute";
import { FakeFlowSink, sceneInputFor } from "./testFakes";
import {
  type FrameSourceOptions,
  type TimelineSnapshot,
  type WebcamTrack,
  createVideoRoute,
} from "./videoRoute";

const settle = () => new Promise((r) => setTimeout(r, 10));

function worker(): GifWorkerLike {
  const w: GifWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => host.handle(message));
    },
    terminate() {},
  };
  const host = createGifWorkerHost((m, transfer) => {
    const copy = structuredClone(m, { transfer });
    queueMicrotask(() => w.onmessage?.({ data: copy }));
  });
  return w;
}

const REGIONS = [{ startMs: 200, endMs: 800 }];

/** Timeline with a real composed webcam layer (enabled, regions) and a sync offset. */
function timeline(webcam: WebcamTrack | null): TimelineSnapshot {
  return {
    clips: [
      { id: "a", sourceStartMs: 0, sourceEndMs: 500, timelineStartMs: 0 },
      { id: "b", sourceStartMs: 900, sourceEndMs: 1400, timelineStartMs: 500 },
    ],
    speeds: [{ startMs: 300, endMs: 600, rate: 2 }],
    sourceFps: 30,
    webcam,
    sceneInput: (size) => ({
      ...sceneInputFor(size),
      clips: [
        { id: "a", sourceStartMs: 0, sourceEndMs: 500, timelineStartMs: 0 },
        { id: "b", sourceStartMs: 900, sourceEndMs: 1400, timelineStartMs: 500 },
      ],
      webcam: {
        settings: initialEditorData().webcam,
        hasWebcam: webcam !== null,
        regions: REGIONS,
        sourceSize: { width: 640, height: 480 },
      },
    }),
  };
}

function fakes(opts: { missingWebcam?: boolean } = {}) {
  const ledger = new FrameLedger();
  const windows: { screen: number[]; webcam: number[] } = { screen: [], webcam: [] };
  const openFrameSource = async (o: FrameSourceOptions) => {
    windows.screen.push(o.maxWindow);
    return new StreamingDecoder({
      source: new FakePacketSource(60, 30, 30),
      createDecoder: (init) => new FakeVideoDecoder(init, ledger),
      maxWindow: o.maxWindow,
    });
  };
  const openWebcamSource = async (_t: WebcamTrack, o: FrameSourceOptions) => {
    windows.webcam.push(o.maxWindow);
    if (opts.missingWebcam) throw new Error("ENOENT: webcam.webm");
    return new StreamingDecoder({
      source: new FakePacketSource(40, 15, 15),
      createDecoder: (init) => new FakeVideoDecoder(init, ledger),
      maxWindow: o.maxWindow,
    });
  };
  return { ledger, windows, openFrameSource, openWebcamSource };
}

const track: WebcamTrack = { url: "reelform-media://root/webcam.webm", syncOffsetMs: 150 };
type Call = FakeRenderer["calls"][number];
const strip = (c: Call) => ({ tMs: c.tMs, cam: c.webcamTimestamp, visible: c.webcamVisible });

async function runVideo(webcam: WebcamTrack | null, missingWebcam = false) {
  const f = fakes({ missingWebcam });
  const renderer = new FakeRenderer(f.ledger);
  const warnings: string[] = [];
  const route = createVideoRoute({
    timeline: timeline(webcam),
    videoUrl: "x",
    renderAudio: async () => null,
    now: () => 0,
    webcodecs: () => createFakeWebCodecs(f.ledger).api,
    openFrameSource: f.openFrameSource,
    openWebcamSource: f.openWebcamSource,
    createRenderer: async () => renderer,
    createMuxer: (o, s) => new FakeMuxer(o, s),
  });
  await route({
    config: { codec: "h264", container: "mp4", width: 64, height: 36, fps: 10, quality: "High" },
    range: { startMs: 0, endMs: 1000 },
    preferHardware: true,
    includeAudio: false,
    burnInCaptions: false,
    sink: new FakeFlowSink(),
    signal: new AbortController().signal,
    onProgress: () => undefined,
    onWarning: (m) => warnings.push(m),
  });
  await settle();
  return { ...f, renderer, warnings };
}

async function runGif(webcam: WebcamTrack | null, missingWebcam = false) {
  const f = fakes({ missingWebcam });
  const renderer = new FakeRenderer(f.ledger);
  const warnings: string[] = [];
  const route = createGifRoute({
    timeline: timeline(webcam),
    createWorker: worker,
    openFrameSource: f.openFrameSource,
    openWebcamSource: f.openWebcamSource,
    createRenderer: async () => renderer,
    readPixels: async (_i, w, h) => solidFrame(w, h, [10, 20, 30]),
    now: () => 0,
  });
  await route({
    options: { width: 64, height: 36, fps: 10, colors: 16, dither: "none", loop: true },
    range: { startMs: 0, endMs: 1000 },
    burnInCaptions: false,
    sink: new FakeFlowSink("/exports/Demo.gif"),
    signal: new AbortController().signal,
    onProgress: () => undefined,
    onWarning: (m) => warnings.push(m),
  });
  await settle();
  return { ...f, renderer, warnings };
}

describe("webcam bubble through the export routes", () => {
  it("video and GIF composite the same webcam frames at the same timeline times", async () => {
    const video = await runVideo(track);
    const gif = await runGif(track);
    expect(video.renderer.calls.length).toBeGreaterThan(0);
    // GIF renders palette samples first; compare its frame pass.
    const gifFrames = gif.renderer.calls.slice(-video.renderer.calls.length);
    expect(gifFrames.map(strip)).toEqual(video.renderer.calls.map(strip));
    for (const c of video.renderer.calls) {
      expect(c.webcamVisible).toBe(webcamVisibleAt(REGIONS, c.tMs));
    }
    expect(video.renderer.calls.some((c) => c.webcamVisible)).toBe(true);
    for (const r of [video, gif]) {
      expect(r.windows.screen.every((w) => w === SCREEN_DECODER_WINDOW_WITH_WEBCAM)).toBe(true);
      expect(r.windows.webcam.every((w) => w === WEBCAM_DECODER_WINDOW)).toBe(true);
      expect(r.ledger.live).toBe(0);
      expect(r.ledger.doubleClose).toBe(0);
      expect(r.ledger.maxLive).toBeLessThanOrEqual(MAX_HELD_FRAMES);
      expect(r.warnings).toEqual([]);
    }
  });

  it("without a webcam track the screen decoder keeps the full window and no bubble is drawn", async () => {
    for (const r of [await runVideo(null), await runGif(null)]) {
      expect(r.windows.webcam).toEqual([]);
      expect(r.windows.screen.every((w) => w === MAX_HELD_FRAMES - 2)).toBe(true);
      expect(r.renderer.calls.every((c: Call) => !c.webcamVisible)).toBe(true);
    }
  });

  it("a missing webcam file finishes both routes without the bubble and warns once", async () => {
    for (const r of [await runVideo(track, true), await runGif(track, true)]) {
      expect(r.renderer.calls.length).toBeGreaterThan(0);
      expect(r.renderer.calls.every((c: Call) => !c.webcamVisible)).toBe(true);
      expect(r.warnings).toEqual([WEBCAM_UNAVAILABLE_NOTICE]);
      expect(r.windows.webcam).toHaveLength(1);
      expect(r.ledger.live).toBe(0);
    }
  });
});
