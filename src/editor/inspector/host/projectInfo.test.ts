import { describe, expect, it } from "vitest";
import {
  absoluteSourcePath,
  projectInfoFromSession,
  roleForPath,
  sourcePaths,
} from "./projectInfo";
import { VIDEO_SOURCE, audioSource, makeMeta } from "./testFixtures";

const video = VIDEO_SOURCE;
const audioSrc = (path: string) => audioSource(path);

describe("projectInfoFromSession", () => {
  it("maps meta, stats, capture backend, telemetry points and audio tracks", () => {
    const meta = makeMeta(
      {},
      {
        mic: audioSrc("media/mic.webm"),
        system: audioSrc("media/system.webm"),
        webcam: { ...video, path: "media/webcam.mp4", width: 1280, height: 720 },
        capture: { backend: "sck", os: "macOS 15", scaleFactor: 2, recordedFps: 60 },
      },
    );
    const info = projectInfoFromSession(
      {
        projectPath: "/Users/me/Demo.reelform",
        meta,
        telemetry: { file: { points: new Array(2531) } } as never,
        mediaOffline: false,
      },
      { "media/screen.mp4": { sizeBytes: 1_000_000 }, "media/mic.webm": null },
      12,
    );
    expect(info).not.toBeNull();
    expect(info?.name).toBe("Demo");
    expect(info?.locationPath).toBe("/Users/me/Demo.reelform");
    expect(info?.sources.map((s) => [s.role, s.absolutePath, s.sizeBytes, s.missing])).toEqual([
      ["video", "/Users/me/Demo.reelform/media/screen.mp4", 1_000_000, false],
      ["mic", "/Users/me/Demo.reelform/media/mic.webm", null, true],
      ["system", "/Users/me/Demo.reelform/media/system.webm", null, false],
      ["webcam", "/Users/me/Demo.reelform/media/webcam.mp4", null, false],
    ]);
    expect(info?.recording).toEqual({
      width: 3024,
      height: 1964,
      fps: 60,
      durationMs: 42_180,
      codec: "h264",
      captureBackend: "ScreenCaptureKit",
      cursorPointCount: 2531,
      audioTracks: ["Microphone", "System audio"],
    });
  });

  it("falls back: no capture info, store point count, source audio, offline video", () => {
    const info = projectInfoFromSession(
      {
        projectPath: null,
        meta: makeMeta({}, { video: { ...video, hasAudio: true } }),
        telemetry: null,
        mediaOffline: true,
      },
      {},
      0,
    );
    expect(info?.recording.captureBackend).toBeNull();
    expect(info?.recording.cursorPointCount).toBeNull();
    expect(info?.recording.audioTracks).toEqual(["Source audio"]);
    expect(info?.sources[0]?.missing).toBe(true);
    expect(info?.sources[0]?.absolutePath).toBe("media/screen.mp4");
  });

  it("returns null without meta", () => {
    expect(
      projectInfoFromSession(
        { projectPath: "/x", meta: null, telemetry: null, mediaOffline: false },
        {},
        null,
      ),
    ).toBeNull();
  });
});

describe("path helpers", () => {
  it("keeps absolute paths and joins relative ones (posix + windows)", () => {
    expect(absoluteSourcePath("/p", "/abs/file.mp4")).toBe("/abs/file.mp4");
    expect(absoluteSourcePath("C:\\P", "D:\\x.mp4")).toBe("D:\\x.mp4");
    expect(absoluteSourcePath("C:\\P", "media/x.mp4")).toBe("C:\\P\\media/x.mp4");
  });

  it("lists source paths and finds roles", () => {
    const meta = makeMeta({}, { mic: audioSrc("media/mic.webm") });
    expect(sourcePaths({ meta })).toEqual(["media/screen.mp4", "media/mic.webm"]);
    expect(roleForPath({ meta }, "media/mic.webm")).toBe("mic");
    expect(roleForPath({ meta }, "nope")).toBeNull();
    expect(sourcePaths({ meta: null })).toEqual([]);
  });
});
