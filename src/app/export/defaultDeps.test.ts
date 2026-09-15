import { describe, expect, it, vi } from "vitest";
import { composeScene } from "../../editor/preview/compose";
import { initialEditorData } from "../../editor/store";
import { initialProjectSession } from "../project/session";
import {
  type ExportStoreSnapshot,
  clipsFor,
  timelineFromSnapshot,
  webcamTrackFor,
} from "./defaultDeps";

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
    expect(clipsFor(snapshot())).toEqual([
      { id: "clip-1", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0 },
    ]);
    expect(clipsFor(snapshot({ durationMs: 0 }))).toEqual([]);
  });
});
