import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wallpaperPackJson from "../../../../public/wallpapers/wallpapers.json";
import { createMetaUpdate } from "../../../app/inspector/historyAdapters";
import { useProjectSession } from "../../../app/project/session";
import { useAppSettings } from "../../../app/settings/store";
import { parseWallpaperPack } from "../../../design/wallpapers";
import { useLoudnessStore } from "../../audio/loudnessStore";
import { createHistory } from "../../state";
import { type EditorState, useEditorStore } from "../../store";
import { DEFAULT_CURSOR_SETTINGS } from "../cursor/types";
import { DEFAULT_FRAME_SETTINGS } from "../frame/types";
import { AudioTab } from "./AudioTab";
import { CaptionsTab } from "./CaptionsTab";
import { CursorTab } from "./CursorTab";
import {
  FrameTab,
  USER_PRESETS_SETTINGS_KEY,
  readUserPresets,
  wallpapersFromPack,
} from "./FrameTab";
import { ProjectTab } from "./ProjectTab";
import { WebcamTab } from "./WebcamTab";
import { fileSystemPath } from "./filePaths";
import { audioSource, fakeHost, makeMeta, resetStores } from "./testFixtures";
import type { ImportedMedia } from "./types";

/** Host-bound Frame, Cursor, Captions (fonts), Audio (loudness) and Webcam (face) tabs. */

const media = (path: string, over: Partial<ImportedMedia> = {}): ImportedMedia => ({
  path,
  url: `reelform-media://p1/${path}`,
  durationMs: null,
  width: null,
  height: null,
  hasAudio: false,
  ...over,
});

const pack = (() => {
  const r = parseWallpaperPack(wallpaperPackJson);
  if (!r.ok) throw new Error(r.message);
  return r.pack;
})();

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "reelform");
  vi.restoreAllMocks();
});

describe("Frame tab", () => {
  const loadWallpapers = async () => wallpapersFromPack(pack);

  it("shows the bundled catalogue with real previews", async () => {
    render(<FrameTab host={fakeHost()} loadWallpapers={loadWallpapers} />);
    const grid = await screen.findByRole("listbox", { name: "Wallpapers" });
    const ember = await within(grid).findByRole("option", { name: "Ember Drift" });
    expect(ember).toHaveAttribute("aria-selected", "true");
    expect(pack.wallpapers.length).toBeGreaterThanOrEqual(40);
    const tiles = wallpapersFromPack(pack);
    expect(tiles.find((w) => w.id === "abstract-1")?.preview).toContain("radial-gradient");
  });

  it("imports a browsed background image through the host (pick fallback)", async () => {
    useEditorStore.setState({
      frame: {
        ...DEFAULT_FRAME_SETTINGS,
        background: { ...DEFAULT_FRAME_SETTINGS.background, kind: "image" },
      },
    });
    const host = fakeHost({
      pickFile: vi.fn(async () => "/Users/me/bg.png"),
      importMedia: vi.fn(async () => media("media/imported/image/bg.png")),
    });
    render(<FrameTab host={host} loadWallpapers={loadWallpapers} />);
    fireEvent.change(screen.getByTestId("image-input"), {
      target: { files: [new File(["x"], "bg.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(useEditorStore.getState().frame.background.image.path).toBe(
        "media/imported/image/bg.png",
      ),
    );
    expect(host.importMedia).toHaveBeenCalledWith("image", "/Users/me/bg.png");
    expect(host.labels).toEqual(["Background image"]);
  });

  it("uses the preload's file path for dropped files and adds custom wallpapers", async () => {
    Object.defineProperty(globalThis, "reelform", {
      value: { getPathForFile: () => "/drop/photo.jpg" },
      configurable: true,
    });
    const pick = vi.fn(async () => "/picked/wall.png");
    const host = fakeHost({
      pickFile: pick,
      importMedia: vi.fn(async (_k, p: string) =>
        media(`media/imported/image/${p.split("/").pop()}`),
      ),
    });
    render(<FrameTab host={host} loadWallpapers={loadWallpapers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add custom…" }));
    await waitFor(() =>
      expect(useEditorStore.getState().frame.background).toMatchObject({
        kind: "image",
        image: { path: "media/imported/image/wall.png" },
      }),
    );
    fireEvent.drop(screen.getByTestId("image-dropzone"), {
      dataTransfer: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() =>
      expect(useEditorStore.getState().frame.background.image.path).toBe(
        "media/imported/image/photo.jpg",
      ),
    );
    expect(pick).toHaveBeenCalledTimes(1);
    expect(host.importMedia).toHaveBeenLastCalledWith("image", "/drop/photo.jpg");
  });

  it("reports import failures inline", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/x.png"),
      importMedia: vi.fn(async () => Promise.reject(new Error("disk full"))),
    });
    render(<FrameTab host={host} loadWallpapers={loadWallpapers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add custom…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't use that image. disk full",
    );
  });

  it("saves the current frame as a named preset into app settings", async () => {
    const patch = vi.spyOn(useAppSettings.getState(), "patch").mockResolvedValue({ ok: true });
    useEditorStore.setState({ frame: { ...DEFAULT_FRAME_SETTINGS, radius: 30 } });
    render(<FrameTab host={fakeHost()} loadWallpapers={loadWallpapers} />);
    fireEvent.click(screen.getByRole("button", { name: "Save current as preset…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save preset" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Preset name"), {
      target: { value: " Launch " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save preset" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const chip = screen.getByRole("button", { name: "Launch" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    const saved = readUserPresets(patch.mock.lastCall?.[0]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "Launch", builtIn: false });
    expect(saved[0]?.settings.radius).toBe(30);
  });

  it("lists presets stored in settings and passes the session source size", () => {
    const settings = useAppSettings.getState().settings;
    useAppSettings.setState({
      settings: {
        ...settings,
        [USER_PRESETS_SETTINGS_KEY]: [
          { id: "u1", name: "Mine", builtIn: false, settings: DEFAULT_FRAME_SETTINGS },
          { id: "bad", name: "Broken" },
        ],
      } as typeof settings,
    });
    expect(readUserPresets(useAppSettings.getState().settings)).toEqual([]);
    useAppSettings.setState({
      settings: {
        ...settings,
        [USER_PRESETS_SETTINGS_KEY]: [
          { id: "u1", name: "Mine", builtIn: false, settings: DEFAULT_FRAME_SETTINGS },
        ],
      } as typeof settings,
    });
    useEditorStore.setState({
      frame: {
        ...DEFAULT_FRAME_SETTINGS,
        aspect: { ...DEFAULT_FRAME_SETTINGS.aspect, preset: "source" },
      },
    });
    render(<FrameTab host={fakeHost()} loadWallpapers={async () => null} />);
    expect(screen.getByRole("button", { name: "Mine" })).toBeInTheDocument();
    expect(screen.getByTestId("output-size")).toHaveTextContent("3024 × 1964");
    useAppSettings.setState({ settings });
  });
});

describe("Cursor tab", () => {
  beforeEach(() => {
    useEditorStore.setState({
      cursorPointCount: 500,
      cursor: {
        ...DEFAULT_CURSOR_SETTINGS,
        style: "custom",
        clickSound: { ...DEFAULT_CURSOR_SETTINGS.clickSound, type: "custom" },
      },
    });
  });

  it("copies an uploaded cursor into the project and selects it", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/Users/me/arrow.svg"),
      importMedia: vi.fn(async () => media("media/imported/image/arrow.svg")),
    });
    render(<CursorTab host={host} />);
    fireEvent.change(screen.getByLabelText("Custom cursor file"), {
      target: { files: [new File(["<svg/>"], "arrow.svg", { type: "image/svg+xml" })] },
    });
    await waitFor(() =>
      expect(useEditorStore.getState().cursor.customCursor).toEqual({
        fileName: "arrow.svg",
        path: "media/imported/image/arrow.svg",
        kind: "svg",
      }),
    );
    expect(host.importMedia).toHaveBeenCalledWith("cursor", "/Users/me/arrow.svg");
    expect(host.labels).toEqual(["Custom cursor"]);
    expect(screen.getByText("arrow.svg")).toBeInTheDocument();
  });

  it("copies a custom click sound", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/Users/me/click.wav"),
      importMedia: vi.fn(async () =>
        media("media/imported/audio/click.wav", { durationMs: 80, hasAudio: true }),
      ),
    });
    render(<CursorTab host={host} />);
    fireEvent.change(screen.getByLabelText("Custom click sound file"), {
      target: { files: [new File(["x"], "click.wav", { type: "audio/wav" })] },
    });
    await waitFor(() =>
      expect(useEditorStore.getState().cursor.clickSound).toMatchObject({
        type: "custom",
        customSound: { fileName: "click.wav", path: "media/imported/audio/click.wav" },
      }),
    );
    expect(host.importMedia).toHaveBeenCalledWith("sound", "/Users/me/click.wav");
  });

  it("shows import errors and does nothing when the pick is cancelled", async () => {
    const importMedia = vi.fn(async () => Promise.reject(new Error("nope")));
    const pick = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null);
    pick.mockResolvedValue("/a.png");
    const host = fakeHost({ pickFile: pick, importMedia });
    render(<CursorTab host={host} />);
    const input = screen.getByLabelText("Custom cursor file");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(1));
    expect(importMedia).not.toHaveBeenCalled();
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add the cursor. nope");
  });
});

describe("fileSystemPath", () => {
  it("prefers the preload bridge, then legacy File.path, else null", () => {
    const file = new File(["x"], "a.png");
    expect(fileSystemPath(file)).toBeNull();
    Object.defineProperty(file, "path", { value: "/legacy/a.png" });
    expect(fileSystemPath(file)).toBe("/legacy/a.png");
    Object.defineProperty(globalThis, "reelform", {
      value: {
        getPathForFile: () => {
          throw new Error("not on disk");
        },
      },
      configurable: true,
    });
    expect(fileSystemPath(file)).toBe("/legacy/a.png");
  });
});

describe("Captions tab custom fonts", () => {
  const added: unknown[] = [];
  class StubFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
    ) {}
    load() {
      return this.source.includes("broken")
        ? Promise.reject(new Error("bad"))
        : Promise.resolve(this);
    }
  }

  beforeEach(() => {
    added.length = 0;
    vi.stubGlobal("FontFace", StubFontFace);
    Object.defineProperty(document, "fonts", {
      value: { add: (f: unknown) => added.push(f) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  });

  it("picks, imports, registers and selects a custom font", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/Users/me/Brand-Bold.woff2"),
      importMedia: vi.fn(async () => media("media/imported/image/Brand-Bold.woff2")),
    });
    render(<CaptionsTab host={host} />);
    const font = screen.getByLabelText("Font");
    fireEvent.change(font, { target: { value: "__add-custom-font__" } });
    await waitFor(() => expect(useEditorStore.getState().captionStyle.font).toBe("Brand Bold"));
    expect(host.importMedia).toHaveBeenCalledWith("font", "/Users/me/Brand-Bold.woff2");
    expect(useEditorStore.getState().captionStyle.customFonts).toEqual([
      {
        family: "Brand Bold",
        fileName: "Brand-Bold.woff2",
        path: "media/imported/image/Brand-Bold.woff2",
      },
    ]);
    expect(added).toHaveLength(1);
    expect(within(font).getByRole("option", { name: "Brand Bold" })).toBeInTheDocument();
    expect(host.labels).toEqual(["Add caption font"]);
  });

  it("explains when the file isn't a loadable font", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/Users/me/broken.ttf"),
      importMedia: vi.fn(async () => media("media/imported/image/broken.ttf")),
    });
    render(<CaptionsTab host={host} />);
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "__add-custom-font__" } });
    expect(await screen.findByText("Couldn't load broken.ttf as a font.")).toBeInTheDocument();
    expect(useEditorStore.getState().captionStyle.customFonts).toEqual([]);
    expect(host.labels).toEqual([]);
  });
});

describe("Audio tab loudness", () => {
  const RATE = 8000;
  const tone = (amp: number) =>
    new Float32Array(RATE * 2).map((_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / RATE));

  beforeEach(() => {
    useLoudnessStore.getState().clear();
    resetStores(makeMeta({}, { mic: audioSource("media/mic.m4a", 2000) }));
    useProjectSession.setState({ micUrl: "reelform-media://p1/media/mic.m4a" });
  });

  it("measures a track the first time Normalize is on and stores its LUFS", async () => {
    const decodeAudio = vi.fn(async () => ({
      channels: [tone(0.25)],
      sampleRate: RATE,
      durationMs: 2000,
    }));
    const host = fakeHost({ decodeAudio });
    render(<AudioTab host={host} />);
    await act(async () => {});
    expect(useLoudnessStore.getState().lufs.mic).toBeUndefined();

    const audio = useEditorStore.getState().audio;
    act(() =>
      useEditorStore.getState().update({
        audio: {
          ...audio,
          tracks: { ...audio.tracks, mic: { ...audio.tracks.mic, normalize: true } },
        },
      }),
    );
    await waitFor(() => expect(useLoudnessStore.getState().lufs.mic).toBeDefined());
    const lufs = useLoudnessStore.getState().lufs.mic ?? 0;
    expect(lufs).toBeLessThan(-10);
    expect(lufs).toBeGreaterThan(-20);

    // Toggling off/on again doesn't re-measure the same source.
    const on = useEditorStore.getState().audio;
    act(() =>
      useEditorStore.getState().update({
        audio: { ...on, tracks: { ...on.tracks, mic: { ...on.tracks.mic, normalize: false } } },
      }),
    );
    act(() => useEditorStore.getState().update({ audio: on }));
    await act(async () => {});
    expect(useLoudnessStore.getState().lufs.system).toBeUndefined();
    expect(decodeAudio).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-measure on remount, and drops a value measured from another source", async () => {
    const audio = useEditorStore.getState().audio;
    useEditorStore.getState().update({
      audio: {
        ...audio,
        tracks: { ...audio.tracks, mic: { ...audio.tracks.mic, normalize: true } },
      },
    });
    // A sentinel no real measurement of the tone would produce (it measures ~−15 LUFS).
    useLoudnessStore.getState().setLufs("mic", -99, "reelform-media://p1/media/mic.m4a");
    useLoudnessStore.getState().setLufs("system", -30, "reelform-media://old/media/system.m4a");
    const decodeAudio = vi.fn(async () => ({
      channels: [tone(0.25)],
      sampleRate: RATE,
      durationMs: 2000,
    }));
    render(<AudioTab host={fakeHost({ decodeAudio })} />);
    // The waveform decode runs; give any (unwanted) measurement time to land.
    await waitFor(() => expect(decodeAudio).toHaveBeenCalled());
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(useLoudnessStore.getState().lufs).toEqual({ mic: -99 });
    expect(useLoudnessStore.getState().sources).toEqual({
      mic: "reelform-media://p1/media/mic.m4a",
    });
  });
});

describe("Project tab trim undo", () => {
  it("undo restores the stashed original; redo trims again from it", async () => {
    resetStores(
      makeMeta({ clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 21_090, timelineStartMs: 0 }] }),
    );
    let t = 0;
    const history = createHistory<EditorState>({
      getState: () => useEditorStore.getState(),
      setState: (s) => useEditorStore.setState(s, true),
      now: () => {
        t += 1000;
        return t;
      },
    });
    const trimmed = (token: string, path: string) => ({
      clips: [{ id: "c", sourceStartMs: 1000, sourceEndMs: 22_090, timelineStartMs: 0 }],
      videoPath: path,
      videoDurationMs: 23_090,
      savedBytes: 500,
      undoToken: token,
    });
    const trimSource = vi
      .fn()
      .mockResolvedValueOnce(trimmed("tok-1", "media/screen-trimmed.mp4"))
      .mockResolvedValueOnce(trimmed("tok-2", "media/screen-trimmed-2.mp4"));
    const restoreTrimmedSource = vi.fn(async (_token: string) => {});
    const host = fakeHost({
      statSources: vi.fn(async () => ({ "media/screen.mp4": { sizeBytes: 1000 } })),
      trimSource,
      restoreTrimmedSource,
      metaUpdate: createMetaUpdate(history),
    });
    render(<ProjectTab host={host} />);
    fireEvent.click(await screen.findByRole("button", { name: /Trim source to used range/ }));
    await waitFor(() =>
      expect(useProjectSession.getState().meta?.sources.video.path).toBe(
        "media/screen-trimmed.mp4",
      ),
    );

    act(() => {
      history.undo();
    });
    expect(useProjectSession.getState().meta?.sources.video.path).toBe("media/screen.mp4");
    expect(useEditorStore.getState().clips[0]?.sourceStartMs).toBe(0);
    await waitFor(() => expect(restoreTrimmedSource).toHaveBeenCalledWith("tok-1"));

    act(() => {
      history.redo();
    });
    await waitFor(() =>
      expect(useProjectSession.getState().meta?.sources.video.path).toBe(
        "media/screen-trimmed-2.mp4",
      ),
    );
    // Redo re-trims from the original clips, not the already-trimmed ones.
    expect(trimSource).toHaveBeenLastCalledWith([
      { id: "c", sourceStartMs: 0, sourceEndMs: 21_090, timelineStartMs: 0 },
    ]);
    expect(useEditorStore.getState().clips[0]?.sourceStartMs).toBe(1000);

    act(() => {
      history.undo();
    });
    await waitFor(() => expect(restoreTrimmedSource).toHaveBeenLastCalledWith("tok-2"));
  });

  it("without a restore port the trim is still one history entry with no effects", async () => {
    resetStores(
      makeMeta({ clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 21_090, timelineStartMs: 0 }] }),
    );
    const metaUpdate = vi.fn();
    const host = fakeHost({
      statSources: vi.fn(async () => ({ "media/screen.mp4": { sizeBytes: 1000 } })),
      trimSource: vi.fn(async () => ({
        clips: [],
        videoPath: "media/t.mp4",
        videoDurationMs: 1,
        savedBytes: 1,
        undoToken: "tok",
      })),
      metaUpdate,
    });
    render(<ProjectTab host={host} />);
    fireEvent.click(await screen.findByRole("button", { name: /Trim source to used range/ }));
    await waitFor(() => expect(metaUpdate).toHaveBeenCalledTimes(1));
    expect(metaUpdate.mock.lastCall?.[3]).toBeUndefined();
  });
});

describe("Webcam tab", () => {
  it("wires Center on face to the face detector with the webcam URL", async () => {
    resetStores(
      makeMeta(
        {},
        { webcam: { ...audioSource("media/webcam.mp4", 4000), width: 1280, height: 720 } },
      ),
    );
    useProjectSession.setState({ webcamUrl: "reelform-media://p1/media/webcam.mp4" });
    useEditorStore.setState({ webcam: { ...useEditorStore.getState().webcam, enabled: true } });
    const detectFace = vi.fn(async () => ({ x: 0.3, y: 0.4 }));
    render(<WebcamTab host={fakeHost()} detectFace={detectFace} />);
    fireEvent.click(screen.getByRole("button", { name: "Crop / reframe" }));
    fireEvent.click(await screen.findByRole("button", { name: "Center on face" }));
    await waitFor(() =>
      expect(detectFace).toHaveBeenCalledWith("reelform-media://p1/media/webcam.mp4"),
    );
  });
});
