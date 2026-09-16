import { describe, expect, it, vi } from "vitest";
import type { ZoomRegion } from "../../editor/inspector/zoom/types";
import { composeScene } from "../../editor/preview/compose";
import { initialEditorData } from "../../editor/store";
import { StreamingDecoder } from "../../export/engine/streamingDecoder";
import {
  FakeMuxer,
  FakePacketSource,
  FakeRenderer,
  FakeVideoDecoder,
  FrameLedger,
  createFakeWebCodecs,
} from "../../export/engine/testFakes";
import { initialProjectSession } from "../project/session";
import {
  type ExportStoreSnapshot,
  clipsFor,
  timelineFromSnapshot,
  webcamTrackFor,
} from "./defaultDeps";
import { FakeFlowSink } from "./testFakes";
import { createVideoRoute } from "./videoRoute";

function snapshot(patch: Partial<ExportStoreSnapshot["editor"]> = {}): ExportStoreSnapshot {
  const editor = { ...initialEditorData(), durationMs: 4000, ...patch };
  return {
    editor,
    session: {
      ...initialProjectSession(),
      projectId: "p1",
      videoUrl: "reelform-media://root/video.mp4",
      sourceSize: { width: 1920, height: 1080 },
    },
  };
}

const caption = { id: "c1", startMs: 0, endMs: 3000, text: "Hello export", words: [] };

describe("timelineFromSnapshot", () => {
  it("builds the full composition input (annotations, captions, effects) like the preview", () => {
    const snap = snapshot({ captions: [caption] as never });
    const t = timelineFromSnapshot(snap);
    const input = t.sceneInput({ width: 1280, height: 720 }, { fps: 30, burnInCaptions: true });
    expect(input.canvas).toEqual({ width: 1280, height: 720 });
    expect(input.fps).toBe(30);
    expect(input.durationMs).toBe(4000);
    expect(input.annotations).toBe(snap.editor.annotations);
    expect(input.effects).toBe(snap.editor.effects);
    expect(input.captions?.enabled).toBe(true);
    expect(input.captions?.captions).toHaveLength(1);
    expect(input.clips).toEqual(clipsFor(snap));
    // The composed scene carries the caption layer when burned in…
    const burned = composeScene(input, 1000);
    expect(burned.composition).toBeDefined();
    expect(burned.composition?.captions.visible).toBe(true);
    // …and not when the user picked a sidecar / none.
    const plain = composeScene(
      t.sceneInput({ width: 1280, height: 720 }, { fps: 30, burnInCaptions: false }),
      1000,
    );
    expect(plain.composition?.captions.visible).toBe(false);
  });

  it("without a webcam track the bubble is off and no webcam is decoded", () => {
    const t = timelineFromSnapshot(snapshot());
    const input = t.sceneInput({ width: 640, height: 360 }, { fps: 60, burnInCaptions: false });
    expect(input.webcam?.hasWebcam).toBe(false);
    expect(t.webcam).toBeNull();
  });

  it("a webcam track composes the bubble with its regions, source size and sync offset", () => {
    const base = snapshot({ webcam: { ...initialEditorData().webcam, syncOffsetMs: -120 } });
    const video = {
      path: "media/screen.mp4",
      width: 1920,
      height: 1080,
      fps: 60,
      durationMs: 4000,
    };
    const snap: ExportStoreSnapshot = {
      ...base,
      session: {
        ...base.session,
        webcamUrl: "reelform-media://root/webcam.webm",
        meta: {
          sources: {
            video,
            webcam: { ...video, path: "media/webcam.webm", width: 640, height: 480 },
          },
          webcamRegions: [{ startMs: 1000, endMs: 2000 }],
        } as never,
      },
    };
    const t = timelineFromSnapshot(snap);
    expect(t.webcam).toEqual({ url: "reelform-media://root/webcam.webm", syncOffsetMs: -120 });
    const input = t.sceneInput({ width: 1280, height: 720 }, { fps: 30, burnInCaptions: false });
    expect(input.webcam).toMatchObject({
      hasWebcam: true,
      sourceSize: { width: 640, height: 480 },
      regions: [{ startMs: 1000, endMs: 2000 }],
    });
    expect(composeScene(input, 1500).composition?.webcam.visible).toBe(true);
    expect(composeScene(input, 2500).composition?.webcam.visible).toBe(false);
  });

  it("a disabled webcam or offline media exports no bubble", () => {
    const base = snapshot();
    const withUrl = { ...base.session, webcamUrl: "reelform-media://root/webcam.webm" };
    const disabled = snapshot({ webcam: { ...initialEditorData().webcam, enabled: false } });
    expect(webcamTrackFor({ ...disabled, session: withUrl })).toBeNull();
    expect(webcamTrackFor({ ...base, session: { ...withUrl, mediaOffline: true } })).toBeNull();
    expect(webcamTrackFor({ ...base, session: withUrl })).not.toBeNull();
  });

  it("prepare loads the wallpaper manifest once and exposes it to later scene inputs", async () => {
    const fetchJson = vi.fn(async () => [
      { id: "aurora", name: "Aurora", kind: "linear", angle: 90, stops: ["#112233", "#445566"] },
    ]);
    const t = timelineFromSnapshot(snapshot(), { fetchJson });
    const size = { width: 640, height: 360 };
    const opts = { fps: 30, burnInCaptions: false };
    expect(t.sceneInput(size, opts).wallpapers).toBeNull();
    const signal = new AbortController().signal;
    await Promise.all([t.prepare?.(signal), t.prepare?.(signal)]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const reg = t.sceneInput(size, opts).wallpapers;
    // An unparseable manifest yields no registry; a parseable one yields a map.
    expect(reg?.size).toBe(1);
    expect(reg?.get("aurora")).toBeDefined();
  });

  it("a failing manifest fetch never fails the export", async () => {
    const t = timelineFromSnapshot(snapshot(), {
      fetchJson: async () => {
        throw new Error("offline");
      },
    });
    await expect(t.prepare?.(new AbortController().signal)).resolves.toBeUndefined();
    expect(
      t.sceneInput({ width: 2, height: 2 }, { fps: 30, burnInCaptions: false }).wallpapers,
    ).toBeNull();
  });
});

describe("clipsFor", () => {
  it("falls back to one identity clip over the editor duration, or none when empty", () => {
    expect(clipsFor(snapshot({ clips: [] }))).toEqual([
      { id: "clip-1", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0 },
    ]);
    expect(clipsFor(snapshot({ clips: [], durationMs: 0 }))).toEqual([]);
  });

  it("the editor's clips win over the clips loaded with the project (preview parity)", () => {
    const snap = trimmedSnapshot();
    expect(clipsFor(snap)).toEqual(TRIMMED_CLIPS);
    expect(clipsFor({ ...snap, editor: { ...snap.editor, clips: [] } })).toEqual(STALE_META_CLIPS);
  });
});

const zoom2x = (startMs: number, endMs: number): ZoomRegion => ({
  id: "z1",
  startMs,
  endMs,
  level: 2,
  easeInMs: 0,
  easeOutMs: 0,
  curve: "linear",
  source: "manual",
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
});

/** Loaded with the project: one 4 s clip. */
const STALE_META_CLIPS = [
  { id: "clip-1", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0 },
];
/** After deleting source 1–2 s in the editor: a 3 s timeline. */
const TRIMMED_CLIPS = [
  { id: "clip-1", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0 },
  { id: "clip-2", sourceStartMs: 2000, sourceEndMs: 4000, timelineStartMs: 1000 },
];

function trimmedSnapshot(): ExportStoreSnapshot {
  const base = snapshot({ durationMs: 3000, clips: TRIMMED_CLIPS });
  const video = { path: "media/screen.mp4", width: 1920, height: 1080, fps: 30, durationMs: 4000 };
  return {
    ...base,
    session: { ...base.session, meta: { sources: { video }, clips: STALE_META_CLIPS } as never },
  };
}

/** Runs the real MP4 route (fake WebCodecs/renderer) and records each rendered frame's camera. */
async function exportCameras(snap: ExportStoreSnapshot, range: { startMs: number; endMs: number }) {
  const ledger = new FrameLedger();
  const fake = createFakeWebCodecs(ledger, {});
  const renderer = new FakeRenderer(ledger);
  const cameras: {
    tMs: number;
    scale: number;
    regionId: string | null;
    /** Decoded source frame timestamp (µs), or null when no video was drawn. */
    sourceUs: number | null;
  }[] = [];
  const render = renderer.render.bind(renderer);
  renderer.render = (state, frame) => {
    cameras.push({
      tMs: state.tMs,
      scale: state.camera.scale,
      regionId: state.camera.regionId,
      sourceUs: frame ? frame.timestamp : null,
    });
    return render(state, frame);
  };
  const route = createVideoRoute({
    timeline: timelineFromSnapshot(snap, { fetchJson: async () => ({ wallpapers: [] }) }),
    videoUrl: "reelform-media://root/video.mp4",
    renderAudio: async () => null,
    now: () => 0,
    webcodecs: () => fake.api,
    openFrameSource: async () =>
      new StreamingDecoder({
        source: new FakePacketSource(120, 30, 30),
        createDecoder: (init) => new FakeVideoDecoder(init, ledger),
      }),
    createRenderer: async () => renderer,
    createMuxer: (opts, sink) => new FakeMuxer(opts, sink),
  });
  await route({
    config: { codec: "h264", container: "mp4", width: 640, height: 360, fps: 30, quality: "High" },
    range,
    preferHardware: true,
    includeAudio: false,
    burnInCaptions: false,
    sink: new FakeFlowSink(),
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });
  return cameras;
}

describe("zoom regions reach the exported frames", () => {
  it("renders the camera at 2x inside a zoom region and 1x outside, like the preview", async () => {
    const region = zoom2x(1000, 2000);
    const snap = snapshot({ durationMs: 3000, zoomRegions: [region] });
    const cameras = await exportCameras(snap, { startMs: 0, endMs: 3000 });
    expect(cameras).toHaveLength(90);
    const at = (ms: number) => cameras.find((c) => Math.abs(c.tMs - ms) < 1e-6);
    expect(at(500)).toMatchObject({ scale: 1, regionId: null });
    expect(at(1500)).toMatchObject({ scale: 2, regionId: "z1" });
    expect(at(2500)).toMatchObject({ scale: 1, regionId: null });
    // Every exported frame matches the preview's scene at the same timeline time.
    const input = timelineFromSnapshot(snap).sceneInput(
      { width: 640, height: 360 },
      { fps: 30, burnInCaptions: false },
    );
    for (const c of cameras) expect(c.scale).toBe(composeScene(input, c.tMs).camera.scale);
  });

  it("an edited (trimmed) timeline exports its own length with the zoom at the preview's time", async () => {
    const snap = trimmedSnapshot();
    const withZoom = { ...snap, editor: { ...snap.editor, zoomRegions: [zoom2x(1000, 2000)] } };
    const cameras = await exportCameras(withZoom, { startMs: 0, endMs: 3000 });
    // Stale project clips would plan a 4 s timeline (120 frames) and shift the zoom.
    expect(cameras).toHaveLength(90);
    const zoomed = cameras.filter((c) => c.scale === 2);
    expect(zoomed[0]?.tMs).toBeCloseTo(1000, 6);
    expect(zoomed.at(-1)?.tMs).toBeCloseTo(2000, 6);
    // Inside the zoom, timeline 1.5 s plays source 2.5 s (clip-2), as in the preview;
    // the stale project clips would decode source 1.5 s — the content that was cut.
    const mid = cameras.find((c) => Math.abs(c.tMs - 1500) < 1e-6);
    expect(mid).toMatchObject({ scale: 2, sourceUs: 2_500_000 });
  });
});
