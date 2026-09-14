import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseProject } from "../model/schema";
import { loadProject } from "../model/v1";
import { m0Fixture } from "../model/v1/fixtures";
import { initialEditorData } from "../store";
import { buildTracks } from "../timelineBinding";
import { editorDataArb } from "./arbitraries";
import {
  DEFAULT_TELEMETRY_PATH,
  type ProjectMeta,
  fromProjectDocument,
  metaFromProjectDocument,
  parseProjectDocumentText,
  serializeProjectDocument,
  toProjectDocument,
} from "./mapping";

const meta = (over: Partial<ProjectMeta> = {}): ProjectMeta => ({
  id: "p1",
  name: "Demo",
  createdAt: "2026-09-14T10:00:00.000Z",
  modifiedAt: "2026-09-14T10:00:00.000Z",
  appVersion: "1.0.0",
  sources: {
    video: {
      path: "media/screen.mp4",
      durationMs: 92_000,
      width: 2880,
      height: 1800,
      fps: 60,
      codec: "h264",
      hasAudio: false,
    },
  },
  ...over,
});

const richMeta = meta({
  sources: {
    ...meta().sources,
    mic: {
      path: "media/mic.m4a",
      durationMs: 92_000,
      width: 1,
      height: 1,
      fps: 1,
      codec: "aac",
      hasAudio: true,
    },
    telemetry: { path: "media/telemetry.json.gz", hasClicks: true, hasKeys: true, sampleHz: 120 },
    capture: { backend: "sck", os: "darwin", display: 1, scaleFactor: 2, recordedFps: 60 },
  },
  clips: [
    { id: "k1", sourceStartMs: 0, sourceEndMs: 40_000, timelineStartMs: 0 },
    { id: "k2", sourceStartMs: 50_000, sourceEndMs: 92_000, timelineStartMs: 40_000 },
  ],
  transitions: [{ id: "t1", afterClipId: "k1", kind: "cross-dissolve", durationMs: 400 }],
  webcamRegions: [{ startMs: 0, endMs: 10_000 }],
  exportPresets: [{ name: "Twitter", format: "mp4", width: 1920, height: 1080, fps: 60, extra: 1 }],
  lastExport: { format: "gif", fps: 15 },
  ui: { inspectorTab: "zoom", timelineZoom: 0.5, timelineHeight: 300, collapsed: { audio: true } },
});

/** Save → disk text → load, as the real app does. */
const throughDisk = (text: string) => {
  const r = parseProjectDocumentText(text);
  if (!r.ok) throw new Error(`${r.error.message}\n${JSON.stringify(r.error.issues, null, 2)}`);
  return r.project;
};

describe("editor data ↔ project document", () => {
  it("property: data → doc → JSON → validated doc → data is lossless", () => {
    fc.assert(
      fc.property(editorDataArb, fc.constantFrom(meta(), richMeta), (data, m) => {
        const doc = throughDisk(serializeProjectDocument(toProjectDocument(data, m)));
        expect(fromProjectDocument(doc)).toEqual(data);
      }),
      { numRuns: 150 },
    );
  });

  it("property: doc → (data, meta) → doc is lossless", () => {
    fc.assert(
      fc.property(editorDataArb, fc.constantFrom(meta(), richMeta), (data, m) => {
        const doc = throughDisk(serializeProjectDocument(toProjectDocument(data, m)));
        const again = toProjectDocument(fromProjectDocument(doc), metaFromProjectDocument(doc));
        expect(again).toEqual(doc);
      }),
      { numRuns: 100 },
    );
  });

  it("property: timeline tracks are identical after a round-trip", () => {
    fc.assert(
      fc.property(editorDataArb, (data) => {
        const back = fromProjectDocument(
          throughDisk(serializeProjectDocument(toProjectDocument(data, meta()))),
        );
        expect(buildTracks(back)).toEqual(buildTracks(data));
      }),
      { numRuns: 50 },
    );
  });

  it("round-trips the store's initial state", () => {
    const data = initialEditorData();
    expect(fromProjectDocument(loadProject(toProjectDocument(data, meta())))).toEqual(data);
  });

  it("encodes silence (-Infinity) as null on disk", () => {
    const data = initialEditorData();
    data.audio.tracks.mic.volumeDb = Number.NEGATIVE_INFINITY;
    const text = serializeProjectDocument(toProjectDocument(data, meta()));
    expect(JSON.parse(text).audio.tracks.mic.volumeDb).toBeNull();
    expect(fromProjectDocument(throughDisk(text)).audio.tracks.mic.volumeDb).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("caption generation status is transient and comes back idle", () => {
    const data = {
      ...initialEditorData(),
      captionStatus: { kind: "error" as const, message: "x" },
    };
    expect(fromProjectDocument(toProjectDocument(data, meta())).captionStatus).toEqual({
      kind: "idle",
    });
  });

  it("does not alias the input objects", () => {
    const data = initialEditorData();
    const doc = toProjectDocument(data, meta());
    doc.frame.radius = 63;
    expect(data.frame.radius).not.toBe(63);
    const back = fromProjectDocument(doc);
    back.frame.radius = 1;
    expect(doc.frame.radius).toBe(63);
  });

  it("places spec fields where SPEC §4 puts them", () => {
    const data = initialEditorData();
    data.effects.intro = { text: "Hi", bg: "#111114", durationMs: 2500 };
    const doc = toProjectDocument(data, richMeta);
    expect(doc.timeline.intro).toEqual(data.effects.intro);
    expect(doc.timeline.outro).toBeUndefined();
    expect("intro" in doc.effects).toBe(false);
    expect(doc.camera).toEqual(data.zoom.camera);
    expect(doc.sources.telemetry).toEqual({ ...richMeta.sources.telemetry, pointCount: 1204 });
    expect(doc.timeline.transitions).toHaveLength(1);
    expect(doc.lastExport).toEqual({ format: "gif", fps: 15 });
  });

  it("meta defaults: whole-video clip, default telemetry path, no telemetry when count is null", () => {
    const data = initialEditorData();
    const doc = toProjectDocument(data, meta());
    expect(doc.timeline.clips).toEqual([
      { id: "clip-1", sourceStartMs: 0, sourceEndMs: 92_000, timelineStartMs: 0 },
    ]);
    expect(doc.sources.telemetry?.path).toBe(DEFAULT_TELEMETRY_PATH);
    const none = toProjectDocument({ ...data, cursorPointCount: null }, richMeta);
    expect(none.sources.telemetry).toBeUndefined();
  });

  it("keeps audio region offsets through meta", () => {
    const data = initialEditorData();
    data.audio.regions = [
      {
        id: "a1",
        fileName: "music.mp3",
        path: "media/music.mp3",
        startMs: 0,
        endMs: 5000,
        volumeDb: -6,
        fadeInMs: 0,
        fadeOutMs: 0,
        loop: false,
        duck: { enabled: true, amountDb: 12 },
      },
    ];
    const doc = toProjectDocument(data, meta({ audioRegionOffsets: { a1: 1500 } }));
    expect(doc.timeline.audioRegions[0]?.offsetMs).toBe(1500);
    expect(metaFromProjectDocument(doc).audioRegionOffsets).toEqual({ a1: 1500 });
  });

  it("hydrates an M0 fixture into editor data with defaults", () => {
    const data = fromProjectDocument(loadProject(m0Fixture()));
    const init = initialEditorData();
    expect(data.durationMs).toBe(10_000);
    expect(data.cursorPointCount).toBeNull();
    expect(data.frame).toEqual(init.frame);
    expect(data.audio).toEqual(init.audio);
    expect(data.speedRegions).toEqual([
      { id: "s1", startMs: 1000, endMs: 2000, rate: 2, keepPitch: true, rampInMs: 0, rampOutMs: 0 },
    ]);
  });

  it("v1 documents stay readable by the M0 subset parser", () => {
    fc.assert(
      fc.property(editorDataArb, (data) => {
        const text = serializeProjectDocument(toProjectDocument(data, richMeta));
        expect(() => parseProject(JSON.parse(text))).not.toThrow();
      }),
      { numRuns: 30 },
    );
  });

  it("parseProjectDocumentText reports invalid JSON with a typed error", () => {
    const r = parseProjectDocumentText("{ not json");
    expect(!r.ok && r.error.code).toBe("invalid-json");
  });
});
