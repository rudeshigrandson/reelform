import { projectV1Schema } from "../../editor/model/v1";
import { migrate } from "../../editor/model/v1";
import {
  type RecordingSetup,
  buildRecordingDocument,
  captureOptionsFor,
  codecFromMime,
  displayIdFor,
  initialRegionCrop,
  planMedia,
  recordedPixelSize,
  recordingProjectName,
  resolvedFileNames,
  sourceLabel,
  systemAudioSupported,
  toPickerSources,
  toSourceItems,
  toStartRequest,
  usesFallbackCapture,
} from "./document";
import { SOURCES, finalizeFixture } from "./testFakes";

const setup: RecordingSetup = {
  sourceId: "d1",
  mode: "screen",
  mic: false,
  systemAudio: false,
  webcam: false,
  fps: 60,
  countdown: 3,
  hideCursor: false,
};

describe("toStartRequest", () => {
  it("display with defaults", () => {
    expect(toStartRequest(setup)).toEqual({
      source: { kind: "display", id: "d1" },
      audio: { system: false },
      fps: 60,
      countdown: 3,
      hideCursor: false,
    });
  });

  it("window with mic, webcam and system audio", () => {
    expect(
      toStartRequest({
        ...setup,
        mode: "window",
        sourceId: "window:42:0",
        mic: true,
        micDeviceId: "mic-usb",
        webcam: true,
        systemAudio: true,
      }),
    ).toEqual({
      source: { kind: "window", id: "window:42:0" },
      audio: { system: true, mic: "mic-usb" },
      webcam: "default",
      fps: 60,
      countdown: 3,
      hideCursor: false,
    });
  });

  it("region only in region mode", () => {
    const region = { x: 10, y: 20, width: 640, height: 360 };
    expect(toStartRequest({ ...setup, mode: "region", region }).region).toEqual(region);
    expect(toStartRequest({ ...setup, mode: "screen", region }).region).toBeUndefined();
  });
});

describe("sources", () => {
  it("toSourceItems per mode, in pixels", () => {
    expect(toSourceItems(null, "screen")).toEqual([]);
    expect(toSourceItems(SOURCES, "screen")).toEqual([
      { id: "d1", kind: "display", name: "Studio Display", width: 3024, height: 1964 },
      { id: "d2", kind: "display", name: "LG UltraFine", width: 1920, height: 1080 },
    ]);
    expect(toSourceItems(SOURCES, "region")).toHaveLength(2);
    expect(toSourceItems(SOURCES, "window")).toEqual([
      {
        id: "window:42:0",
        kind: "window",
        name: "Figma — Onboarding.fig",
        width: 2560,
        height: 1440,
      },
    ]);
  });

  it("labels and display ids", () => {
    expect(sourceLabel(setup, SOURCES)).toBe("Studio Display");
    expect(sourceLabel({ ...setup, mode: "window", sourceId: "window:42:0" }, SOURCES)).toBe(
      "Figma — Onboarding.fig",
    );
    expect(
      sourceLabel(
        { ...setup, mode: "region", region: { x: 0, y: 0, width: 1280.4, height: 720 } },
        null,
      ),
    ).toBe("1280×720 region");
    expect(sourceLabel({ ...setup, sourceId: "gone" }, SOURCES)).toBe("Display");
    expect(displayIdFor({ ...setup, mode: "window", sourceId: "window:42:0" }, SOURCES)).toBe("d1");
    expect(displayIdFor({ ...setup, mode: "window", sourceId: "x" }, SOURCES)).toBeUndefined();
  });

  it("captureOptionsFor uses the desktopCapturer id and refuses displays without one", () => {
    const res = captureOptionsFor("s1", { ...setup, mic: true }, SOURCES, "darwin");
    expect(res).toEqual({
      ok: true,
      options: {
        sessionId: "s1",
        platform: "darwin",
        desktop: {
          sourceId: "screen:1:0",
          size: { x: 0, y: 0, width: 1512, height: 982 },
          scaleFactor: 2,
        },
        fps: 60,
        systemAudio: false,
        mic: { deviceId: undefined },
      },
    });
    const noId = {
      ...SOURCES,
      displays: SOURCES.displays.map(({ mediaSourceId: _m, ...d }) => d),
    };
    expect(captureOptionsFor("s1", setup, noId, "linux")).toMatchObject({
      ok: false,
      code: "SOURCE_NOT_CAPTURABLE",
    });
    expect(captureOptionsFor("s1", setup, null, "linux").ok).toBe(false);
    const win = captureOptionsFor(
      "s1",
      { ...setup, mode: "window", sourceId: "window:42:0", webcam: true, webcamDeviceId: "cam" },
      SOURCES,
      "win32",
    );
    expect(win).toMatchObject({
      ok: true,
      options: {
        desktop: { sourceId: "window:42:0", scaleFactor: 2 },
        webcam: { deviceId: "cam" },
      },
    });
  });
});

describe("finalized recording → project", () => {
  it("planMedia moves every file into media/ keeping extensions", () => {
    const fin = finalizeFixture();
    fin.webcam = { path: "/rec/s1/webcam.webm" };
    fin.system = { path: "C:\\rec\\s1\\system.m4a" };
    expect(planMedia(fin)).toEqual({
      imports: [
        { sourcePath: "/rec/s1/screen.webm", fileName: "screen.webm", move: true },
        { sourcePath: "/rec/s1/mic.webm", fileName: "mic.webm", move: true },
        { sourcePath: "C:\\rec\\s1\\system.m4a", fileName: "system.m4a", move: true },
        { sourcePath: "/rec/s1/webcam.webm", fileName: "webcam.webm", move: true },
        { sourcePath: "/rec/s1/telemetry.json.gz", fileName: "telemetry.json.gz", move: true },
      ],
      fileNames: {
        screen: "screen.webm",
        mic: "mic.webm",
        system: "system.m4a",
        webcam: "webcam.webm",
        telemetry: "telemetry.json.gz",
      },
    });
  });

  it("resolvedFileNames follows uniquified names by request order", () => {
    const plan = planMedia(finalizeFixture());
    expect(
      resolvedFileNames(plan, ["screen (1).webm", "mic.webm", "telemetry (2).json.gz"]),
    ).toEqual({ screen: "screen (1).webm", mic: "mic.webm", telemetry: "telemetry (2).json.gz" });
    expect(resolvedFileNames(plan, [])).toEqual(plan.fileNames);
  });

  it("builds a v1 document main accepts", () => {
    const fin = finalizeFixture();
    const doc = buildRecordingDocument({
      fin,
      sources: SOURCES,
      mimeTypes: { screen: "video/webm;codecs=vp9", mic: "audio/webm;codecs=opus" },
      fileNames: planMedia(fin).fileNames,
      id: "p1",
      name: recordingProjectName("2026-09-15T14:32:05.000Z"),
      nowIso: "2026-09-15T14:32:05.000Z",
      appVersion: "1.0.0",
    });
    const migrated = migrate(JSON.parse(JSON.stringify(doc)));
    expect(migrated.ok).toBe(true);
    expect(projectV1Schema.safeParse(doc).success).toBe(true);
    expect(doc.name).toBe("Recording 2026-09-15 at 14.32.05");
    expect(doc.sources.video).toEqual({
      path: "media/screen.webm",
      durationMs: 42_180,
      width: 3024,
      height: 1964,
      fps: 60,
      codec: "vp9",
      hasAudio: false,
    });
    expect(doc.sources.mic).toMatchObject({
      path: "media/mic.webm",
      codec: "opus",
      hasAudio: true,
    });
    expect(doc.sources.telemetry).toEqual({
      path: "media/telemetry.json.gz",
      pointCount: 12,
      hasClicks: false,
      hasKeys: false,
      sampleHz: 120,
    });
    expect(doc.sources.capture).toEqual({
      backend: "electron",
      os: "darwin 25.5",
      display: "d1",
      scaleFactor: 2,
      recordedFps: 60,
    });
    expect(doc.timeline.durationMs).toBe(42_180);
    expect(doc.timeline.clips).toHaveLength(1);
    expect(doc.frame.crop).toBeNull();
  });

  it("interrupted, zero-length, window + webcam recordings still validate", () => {
    const fin = finalizeFixture({
      durationMs: 0,
      interrupted: "diskLow",
      source: { kind: "window", id: "window:42:0" },
      recordedFps: 0,
      backend: "sck",
    });
    const { mic: _mic, ...withoutMic } = { ...fin, webcam: { path: "/rec/s1/webcam.mp4" } };
    const doc = buildRecordingDocument({
      fin: withoutMic,
      sources: null,
      fileNames: planMedia(withoutMic).fileNames,
      id: "p2",
      name: "R",
      nowIso: "2026-09-15T14:32:05.000Z",
      appVersion: "1.0.0",
    });
    expect(projectV1Schema.safeParse(doc).success).toBe(true);
    expect(doc.sources.video).toMatchObject({ durationMs: 1, width: 1920, fps: 30, codec: "h264" });
    expect(doc.sources.webcam).toMatchObject({ path: "media/webcam.mp4", width: 1280 });
    expect(doc.sources.mic).toBeUndefined();
    expect(doc.sources.capture).toMatchObject({ backend: "sck", window: "window:42:0" });
  });

  it("region: native backends record the region size; electron records the display and crops", () => {
    const region = { x: 378, y: 245.5, width: 756, height: 491 };
    const native = finalizeFixture({ backend: "sck", region });
    expect(recordedPixelSize(native, SOURCES)).toEqual({ width: 1512, height: 982 });
    expect(initialRegionCrop(native, SOURCES)).toBeNull();
    const electron = finalizeFixture({ region });
    expect(recordedPixelSize(electron, SOURCES)).toEqual({ width: 3024, height: 1964 });
    expect(initialRegionCrop(electron, SOURCES)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    const doc = buildRecordingDocument({
      fin: electron,
      sources: SOURCES,
      fileNames: planMedia(electron).fileNames,
      id: "p3",
      name: "R",
      nowIso: "2026-09-15T14:32:05.000Z",
      appVersion: "1.0.0",
    });
    expect(doc.frame.crop).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(doc.sources.capture?.region).toEqual(region);
    expect(projectV1Schema.safeParse(doc).success).toBe(true);
    // Out-of-bounds regions are clamped into the display; degenerate ones dropped.
    expect(
      initialRegionCrop(
        finalizeFixture({ region: { x: 1400, y: 0, width: 500, height: 100 } }),
        SOURCES,
      ),
    ).toMatchObject({ x: 1400 / 1512, width: 1 - 1400 / 1512 });
    expect(
      initialRegionCrop(
        finalizeFixture({ region: { x: 2000, y: 0, width: 5, height: 5 } }),
        SOURCES,
      ),
    ).toBeNull();
    expect(initialRegionCrop(electron, null)).toBeNull();
  });

  it("codecFromMime / recordingProjectName", () => {
    expect(codecFromMime("video/webm;codecs=avc1.42E01E", "x")).toBe("h264");
    expect(codecFromMime("video/webm;codecs=vp8", "x")).toBe("vp8");
    expect(codecFromMime("audio/mp4;codecs=mp4a.40.2", "x")).toBe("aac");
    expect(codecFromMime(undefined, "vp9")).toBe("vp9");
    expect(recordingProjectName("not a date")).toBe("Recording");
  });
});

describe("toPickerSources / capture capability helpers", () => {
  it("maps displays then windows with titles, app grouping and minimized state", () => {
    const sources = {
      ...SOURCES,
      windows: [
        ...SOURCES.windows,
        {
          id: "window:7:0",
          title: "Inbox",
          thumbnail: "data:image/png;base64,",
          appIcon: "data:icon",
        },
        { id: "window:8:0", title: "Notes", thumbnail: "data:image/png;base64,AAAA" },
      ],
    };
    const items = toPickerSources(sources);
    expect(items.map((i) => [i.id, i.kind, i.title, i.minimized])).toEqual([
      ["d1", "display", "Studio Display", false],
      ["d2", "display", "LG UltraFine", false],
      ["window:42:0", "window", "Onboarding.fig", false],
      ["window:7:0", "window", "Inbox", true],
      ["window:8:0", "window", "Notes", false],
    ]);
    expect(items[2]).toMatchObject({ appName: "Figma", name: "Figma — Onboarding.fig" });
    expect(items[3]?.thumbnailUrl).toBeUndefined();
    expect(items[3]?.appIcon).toBe("data:icon");
    expect(items[4]?.thumbnailUrl).toBe("data:image/png;base64,AAAA");
    expect(toPickerSources(null)).toEqual([]);
  });

  it("fallback capture and system audio support by platform and backend", () => {
    expect(usesFallbackCapture("darwin", "electron")).toBe(true);
    expect(usesFallbackCapture("win32", "electron")).toBe(true);
    expect(usesFallbackCapture("linux", "electron")).toBe(false);
    expect(usesFallbackCapture("darwin", "sck")).toBe(false);
    expect(usesFallbackCapture("darwin", null)).toBe(false);
    expect(systemAudioSupported("darwin", "electron")).toBe(false);
    expect(systemAudioSupported("win32", "electron")).toBe(true);
    expect(systemAudioSupported("darwin", "sck")).toBe(true);
    expect(systemAudioSupported("darwin", null)).toBe(true);
  });
});
