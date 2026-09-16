import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectSession } from "../../../app/project/session";
import type { Telemetry } from "../../autozoom";
import { usePlaybackStore } from "../../playback";
import { useEditorStore } from "../../store";
import { InspectorPanel } from "../InspectorPanel";
import { createAnnotation } from "../annotations";
import { REC_MOD } from "./telemetryInputs";
import {
  audioSource,
  fakeCaptionsPort,
  fakeHost,
  makeMeta,
  pcm,
  resetStores,
} from "./testFixtures";
import type { ImportedMedia } from "./types";

/** Every inspector host action end-to-end: panel → fake host → stores. */

const media = (over: Partial<ImportedMedia> = {}): ImportedMedia => ({
  path: "media/imported/audio/song.mp3",
  url: "reelform-media://p1/media/imported/audio/song.mp3",
  durationMs: 4000,
  width: null,
  height: null,
  hasAudio: true,
  ...over,
});

function clickTelemetry(): Telemetry {
  const points: [number, number, number, string][] = [];
  const pos = (t: number): [number, number] =>
    t < 8000 ? [0.2, 0.3] : t < 18_000 ? [0.7, 0.6] : [0.4, 0.8];
  for (let t = 0; t <= 26_000; t += 50) points.push([t, ...pos(t), "arrow"]);
  const clicks = [2000, 10_000, 20_000].flatMap((t) => [
    [t, ...pos(t), "left", "down"] as const,
    [t + 80, ...pos(t), "left", "up"] as const,
  ]);
  return { points, clicks, keys: [], scrolls: [] };
}

const setTelemetry = (telemetry: Telemetry) =>
  useProjectSession.setState({
    telemetry: { file: { points: telemetry.points } as never, telemetry, cursorPoints: [] },
  });

beforeEach(() => {
  resetStores();
  usePlaybackStore.getState().seek(0);
});

describe("multi-select summary (§6.8)", () => {
  const z = (id: string, startMs: number, endMs: number) => ({
    id,
    startMs,
    endMs,
    level: 2,
    focus: { mode: "fixed" as const, x: 0.5, y: 0.5 },
    easeInMs: 0,
    easeOutMs: 0,
    curve: "linear" as const,
    source: "manual" as const,
  });
  const s = (id: string, startMs: number, endMs: number) => ({
    id,
    startMs,
    endMs,
    rate: 2,
    keepPitch: true,
    rampInMs: 0,
    rampOutMs: 0,
  });
  let seq = 0;
  const makeId = (prefix: string) => `${prefix}-new-${++seq}`;

  it("one selected item shows only the tab", () => {
    render(<InspectorPanel tab="Frame" host={fakeHost()} selectedIds={new Set(["a"])} />);
    expect(screen.queryByRole("region", { name: "Selection summary" })).toBeNull();
  });

  it("counts per kind; Duplicate and Delete are single edits that reselect", () => {
    useEditorStore.setState({
      durationMs: 20_000,
      zoomRegions: [z("z1", 0, 1000), z("z2", 3000, 4000)],
      speedRegions: [s("s1", 5000, 6000)],
    });
    const host = fakeHost();
    const onSelect = vi.fn();
    const ids = new Set(["z1", "z2", "s1"]);
    render(
      <InspectorPanel
        tab="Frame"
        host={host}
        selectedIds={ids}
        onSelect={onSelect}
        makeId={makeId}
      />,
    );
    const summary = screen.getByRole("region", { name: "Selection summary" });
    expect(summary).toHaveTextContent("3 items");
    expect(summary).toHaveTextContent("2 zooms");
    expect(summary).toHaveTextContent("1 speed");
    // Both zooms would start at 0 and overlap.
    expect(within(summary).getByRole("button", { name: "Align start" })).toBeDisabled();

    fireEvent.click(within(summary).getByRole("button", { name: "Duplicate" }));
    expect(host.labels).toEqual(["Duplicate"]);
    expect(useEditorStore.getState().zoomRegions).toHaveLength(4);
    const reselected = onSelect.mock.lastCall?.[0] as ReadonlySet<string>;
    expect(reselected.size).toBe(3);
    expect([...reselected].every((id) => id.includes("-new-"))).toBe(true);

    fireEvent.click(within(summary).getByRole("button", { name: "Delete" }));
    expect(host.labels).toEqual(["Duplicate", "Delete"]);
    expect(useEditorStore.getState().zoomRegions.map((r) => r.id)).not.toContain("z1");
    expect(onSelect.mock.lastCall?.[0].size).toBe(0);
  });

  it("Align start moves regions on different tracks to the earliest start", () => {
    useEditorStore.setState({
      durationMs: 20_000,
      zoomRegions: [z("z1", 3000, 4000)],
      speedRegions: [s("s1", 5000, 6000)],
    });
    const host = fakeHost();
    render(<InspectorPanel tab="Zoom" host={host} selectedIds={new Set(["z1", "s1"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Align start" }));
    expect(host.labels).toEqual(["Align start"]);
    expect(useEditorStore.getState().speedRegions[0]).toMatchObject({ startMs: 3000, endMs: 4000 });
  });
});

describe("Zoom tab", () => {
  it("disables generation without telemetry", () => {
    render(<InspectorPanel tab="Zoom" host={fakeHost()} />);
    expect(screen.getByRole("button", { name: "Generate suggestions" })).toBeDisabled();
  });

  it("generates → toast → Keep all commits one history entry", () => {
    setTelemetry(clickTelemetry());
    const host = fakeHost();
    render(<InspectorPanel tab="Zoom" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate suggestions" }));
    const toast = screen.getByRole("status", { name: "Zoom suggestions" });
    const n = Number(/We suggested (\d+) zoom/.exec(toast.textContent ?? "")?.[1]);
    expect(n).toBeGreaterThan(0);
    fireEvent.click(within(toast).getByRole("button", { name: "Keep all" }));
    expect(useEditorStore.getState().zoomRegions).toHaveLength(n);
    expect(host.labels).toEqual(["Keep zoom suggestions"]);
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
  });

  it("regenerate keeps an edited region; Review keeps only chosen suggestions", () => {
    setTelemetry(clickTelemetry());
    const edited = {
      id: "mine",
      startMs: 30_000,
      endMs: 32_000,
      level: 3,
      focus: { mode: "fixed" as const, x: 0.1, y: 0.1 },
      easeInMs: 600,
      easeOutMs: 700,
      curve: "linear" as const,
      source: "manual" as const,
    };
    useEditorStore.setState({
      zoomRegions: [
        edited,
        { ...edited, id: "stale", startMs: 35_000, endMs: 36_000, source: "auto" },
      ],
    });
    render(<InspectorPanel tab="Zoom" host={fakeHost()} />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const card = () => screen.getByRole("group", { name: "Review zoom suggestions" });
    expect(card()).toHaveTextContent(/Zoom 1 of \d+/);
    fireEvent.click(within(card()).getByRole("button", { name: "Keep" }));
    while (screen.queryByRole("group", { name: "Review zoom suggestions" })) {
      fireEvent.click(within(card()).getByRole("button", { name: "Skip" }));
    }
    const ids = useEditorStore.getState().zoomRegions.map((r) => r.id);
    expect(ids).toContain("mine");
    expect(ids).not.toContain("stale");
    expect(ids).toHaveLength(2);
  });

  it("Dismiss leaves regions untouched", () => {
    setTelemetry(clickTelemetry());
    const host = fakeHost();
    render(<InspectorPanel tab="Zoom" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(useEditorStore.getState().zoomRegions).toEqual([]);
    expect(host.labels).toEqual([]);
  });
});

describe("Captions tab", () => {
  const withMic = () =>
    resetStores(
      makeMeta(
        { clips: [{ id: "c", sourceStartMs: 1000, sourceEndMs: 9000, timelineStartMs: 0 }] },
        { mic: audioSource("media/mic.webm", 42_180) },
      ),
    );

  it("downloads the tier's model with progress, then enables Generate", async () => {
    withMic();
    let installed = false;
    let finish: () => void = () => {};
    const captions = fakeCaptionsPort({
      models: vi.fn(async () => [
        { id: "small-q5_1" as const, installed, downloading: false, displaySize: "190 MB" },
      ]),
      download: vi.fn(
        () =>
          new Promise<void>((r) => {
            finish = () => {
              installed = true;
              r();
            };
          }),
      ),
    });
    render(<InspectorPanel tab="Captions" host={fakeHost({}, captions)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download (190 MB)" }));
    expect(captions.download).toHaveBeenCalledWith("small-q5_1");
    act(() => captions.emit({ kind: "download", taskId: "small-q5_1", progress: 0.5 }));
    act(() => captions.emit({ kind: "download", taskId: "other", progress: 0.9 }));
    expect(screen.getByText(/Downloading Balanced model 50%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(captions.cancelDownload).toHaveBeenCalledWith("small-q5_1");
    await act(async () => finish());
    expect(await screen.findByRole("button", { name: "Generate captions" })).toBeInTheDocument();
  });

  it("transcribes the mic over clip/speed ranges and maps captions to the timeline", async () => {
    withMic();
    useEditorStore.setState({
      speedRegions: [
        {
          id: "s",
          startMs: 2000,
          endMs: 4000,
          rate: 2,
          keepPitch: true,
          rampInMs: 0,
          rampOutMs: 0,
        },
      ],
    });
    const captions = fakeCaptionsPort({
      models: vi.fn(async () => [
        { id: "small-q5_1" as const, installed: true, downloading: false, displaySize: "" },
      ]),
      transcribe: vi.fn(async () => ({
        captions: [{ id: "x", startMs: 2500, endMs: 3000, text: "hi there", words: [] }],
      })),
    });
    const host = fakeHost({}, captions);
    render(<InspectorPanel tab="Captions" host={host} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate captions" }));
    await waitFor(() => expect(useEditorStore.getState().captions).toHaveLength(1));
    const req = vi.mocked(captions.transcribe).mock.calls[0]?.[0];
    expect(req?.audioPath).toBe("/Users/me/Demo.reelform/media/mic.webm");
    expect(req?.model).toBe("small-q5_1");
    expect(req?.ranges).toEqual([
      { startMs: 1000, endMs: 3000 },
      { startMs: 3000, endMs: 5000, rate: 2 },
      { startMs: 5000, endMs: 9000 },
    ]);
    // WAV 2500ms is 500ms into the 2× range → timeline 3000.
    expect(useEditorStore.getState().captions[0]).toMatchObject({ startMs: 3000, endMs: 4000 });
    expect(host.labels).toEqual(["Generate captions"]);
    expect(useEditorStore.getState().captionStatus).toEqual({ kind: "idle" });
  });

  it("derives ranges from the editor store's clips, not stale meta clips", async () => {
    withMic();
    useEditorStore.setState({
      clips: [{ id: "k", sourceStartMs: 6000, sourceEndMs: 8000, timelineStartMs: 0 }],
    });
    const captions = fakeCaptionsPort({
      models: vi.fn(async () => [
        { id: "small-q5_1" as const, installed: true, downloading: false, displaySize: "" },
      ]),
      transcribe: vi.fn(async () => ({
        captions: [{ id: "x", startMs: 500, endMs: 900, text: "cut", words: [] }],
      })),
    });
    render(<InspectorPanel tab="Captions" host={fakeHost({}, captions)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate captions" }));
    await waitFor(() => expect(useEditorStore.getState().captions).toHaveLength(1));
    expect(vi.mocked(captions.transcribe).mock.calls[0]?.[0].ranges).toEqual([
      { startMs: 6000, endMs: 8000 },
    ]);
    expect(useEditorStore.getState().captions[0]).toMatchObject({ startMs: 500, endMs: 900 });
  });

  it("shows the no-speech error and the no-audio error", async () => {
    withMic();
    const captions = fakeCaptionsPort({
      models: vi.fn(async () => [
        { id: "small-q5_1" as const, installed: true, downloading: false, displaySize: "" },
      ]),
      transcribe: vi.fn(async () => ({ captions: [] })),
    });
    const { unmount } = render(<InspectorPanel tab="Captions" host={fakeHost({}, captions)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate captions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't transcribe — no speech detected",
    );
    unmount();

    resetStores(makeMeta());
    render(<InspectorPanel tab="Captions" host={fakeHost({}, captions)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate captions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no audio to transcribe");
  });

  it("surfaces transcription failures from the runtime", async () => {
    withMic();
    const captions = fakeCaptionsPort({
      models: vi.fn(async () => [
        { id: "small-q5_1" as const, installed: true, downloading: false, displaySize: "" },
      ]),
      transcribe: vi.fn(async () => {
        throw Object.assign(new Error("whisper crashed"), { code: "whisper-failed" });
      }),
    });
    render(<InspectorPanel tab="Captions" host={fakeHost({}, captions)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate captions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't transcribe. whisper crashed",
    );
  });

  it("exports SRT/VTT through saveFile and imports a sidecar via pickFile", async () => {
    useEditorStore.setState({
      captions: [{ id: "a", startMs: 1000, endMs: 2500, text: "Hello", words: [] }],
    });
    const host = fakeHost({
      saveFile: vi.fn(async (o) => `/out/${o.defaultName}`),
      pickFile: vi.fn(async () => "/in/subs.vtt"),
      readTextFile: vi.fn(async () => "WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nImported line\n"),
    });
    render(<InspectorPanel tab="Captions" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Export .srt" }));
    await screen.findByText("Saved Demo.srt");
    const srt = vi.mocked(host.saveFile).mock.calls[0]?.[0];
    expect(srt?.contents).toContain("00:00:01,000 --> 00:00:02,500");
    fireEvent.click(screen.getByRole("button", { name: "Export .vtt" }));
    await screen.findByText("Saved Demo.vtt");
    expect(vi.mocked(host.saveFile).mock.calls[1]?.[0].contents).toMatch(/^WEBVTT/);

    fireEvent.click(screen.getByRole("button", { name: "Import .srt/.vtt…" }));
    await screen.findByText("Imported 1 captions");
    expect(useEditorStore.getState().captions.map((c) => c.text)).toEqual(["Imported line"]);
    expect(host.labels).toEqual(["Import captions"]);
  });
});

describe("Webcam tab", () => {
  it("uploads via importMedia, then removes", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/Users/me/cam.mov"),
      importMedia: vi.fn(async () =>
        media({
          path: "media/imported/webcam/cam.mov",
          url: "reelform-media://p1/cam",
          width: 1920,
          height: 1080,
        }),
      ),
    });
    render(<InspectorPanel tab="Webcam" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload video…" }));
    await screen.findByRole("button", { name: "Replace" });
    expect(host.importMedia).toHaveBeenCalledWith("webcam", "/Users/me/cam.mov");
    expect(useProjectSession.getState().meta?.sources.webcam?.path).toBe(
      "media/imported/webcam/cam.mov",
    );
    expect(useProjectSession.getState().webcamUrl).toBe("reelform-media://p1/cam");
    expect(screen.getByText("cam.mov")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(useProjectSession.getState().meta?.sources.webcam).toBeUndefined();
    expect(screen.getByRole("button", { name: "Upload video…" })).toBeInTheDocument();
    expect(host.labels).toEqual(["Add webcam video", "Remove webcam"]);
  });

  it("shows an error when the import fails; cancel is a no-op", async () => {
    const pick = vi.fn(async (): Promise<string | null> => null);
    const host = fakeHost({
      pickFile: pick,
      importMedia: vi.fn(async () => Promise.reject(new Error("disk full"))),
    });
    render(<InspectorPanel tab="Webcam" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload video…" }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(host.importMedia).not.toHaveBeenCalled();
  });

  it("auto-syncs by correlating webcam audio with the mic", async () => {
    resetStores(
      makeMeta(
        {},
        { webcam: { ...audioSource("media/webcam.mp4", 40_000), width: 1280, height: 720 } },
      ),
    );
    useProjectSession.setState({ micUrl: "mic://", webcamUrl: "cam://" });
    const rate = 2000;
    const segs: [number, number][] = [
      [500, 900],
      [1700, 2600],
      [3100, 3300],
      [5000, 6200],
      [7000, 7100],
    ];
    const mic = pcm(rate, 12_000, segs);
    const cam = pcm(
      rate,
      12_000,
      segs.map(([s, e]) => [s + 250, e + 250] as [number, number]),
    );
    const host = fakeHost({
      decodeAudio: vi.fn(async (url: string) => ({
        channels: [url === "mic://" ? mic : cam],
        sampleRate: rate,
        durationMs: 12_000,
      })),
    });
    render(<InspectorPanel tab="Webcam" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-sync" }));
    await screen.findByText("Synced (+250 ms)");
    expect(useEditorStore.getState().webcam.syncOffsetMs).toBe(250);
    expect(host.labels).toEqual(["Auto-sync webcam"]);
  });

  it("auto-sync recovers when decoding throws", async () => {
    resetStores(
      makeMeta({}, { webcam: { ...audioSource("media/webcam.mp4"), width: 1280, height: 720 } }),
    );
    useProjectSession.setState({ micUrl: "mic://", webcamUrl: "cam://" });
    const host = fakeHost({
      decodeAudio: vi.fn(async (url: string) => {
        if (url === "cam://") throw new Error("boom");
        return { channels: [pcm(1000, 2000, [[0, 500]])], sampleRate: 1000, durationMs: 2000 };
      }),
    });
    render(<InspectorPanel tab="Webcam" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-sync" }));
    expect(await screen.findByText(/needs audio in both/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto-sync" })).toBeEnabled();
    expect(host.labels).toEqual([]);
  });

  it("auto-sync explains when audio is missing", async () => {
    resetStores(
      makeMeta({}, { webcam: { ...audioSource("media/webcam.mp4"), width: 1280, height: 720 } }),
    );
    render(<InspectorPanel tab="Webcam" host={fakeHost()} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-sync" }));
    expect(await screen.findByText(/needs audio in both/)).toBeInTheDocument();
  });
});

describe("Audio tab", () => {
  it("reflects track availability from the session", () => {
    resetStores(makeMeta({}, { mic: audioSource("media/mic.webm") }));
    render(<InspectorPanel tab="Audio" host={fakeHost()} />);
    expect(screen.getByRole("group", { name: "Microphone" })).toBeInTheDocument();
    expect(screen.getByText("System audio not available")).toBeInTheDocument();
  });

  it("decodes track waveforms", async () => {
    resetStores(makeMeta({}, { mic: audioSource("media/mic.webm") }));
    useProjectSession.setState({ micUrl: "mic://" });
    const host = fakeHost({
      decodeAudio: vi.fn(async () => ({
        channels: [pcm(1000, 1000, [[0, 500]])],
        sampleRate: 1000,
        durationMs: 1000,
      })),
    });
    render(<InspectorPanel tab="Audio" host={host} />);
    await waitFor(() =>
      expect(screen.getByTestId("waveform-mic")).not.toHaveAttribute("data-empty"),
    );
  });

  it("adds extra audio at the playhead with a decoded waveform", async () => {
    usePlaybackStore.getState().setDuration(42_180);
    usePlaybackStore.getState().seek(1000);
    const host = fakeHost({
      pickFile: vi.fn(async () => "/music/song.mp3"),
      importMedia: vi.fn(async () => media()),
      decodeAudio: vi.fn(async () => ({
        channels: [pcm(1000, 4000, [[0, 4000]])],
        sampleRate: 1000,
        durationMs: 4000,
      })),
    });
    render(<InspectorPanel tab="Audio" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Add audio…" }));
    const group = await screen.findByRole("group", { name: "song.mp3" });
    const region = useEditorStore.getState().audio.regions[0];
    expect(region).toMatchObject({
      fileName: "song.mp3",
      path: "media/imported/audio/song.mp3",
      startMs: 1000,
      endMs: 5000,
    });
    expect(within(group).getByTestId(`waveform-region-${region?.id}`)).toBeInTheDocument();
    expect(host.labels).toEqual(["Add audio"]);
  });

  it("reports import failures", async () => {
    const host = fakeHost({
      pickFile: vi.fn(async () => "/music/bad.mp3"),
      importMedia: vi.fn(async () => media({ durationMs: null })),
    });
    render(<InspectorPanel tab="Audio" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Add audio…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no readable audio");
    expect(useEditorStore.getState().audio.regions).toEqual([]);
  });
});

describe("Effects tab", () => {
  it("removes silence as ripple clip cuts in one history entry", async () => {
    resetStores(
      makeMeta(
        {},
        {
          video: { ...makeMeta().sources.video, durationMs: 3000 },
          mic: audioSource("media/mic.webm", 3000),
        },
      ),
    );
    useProjectSession.setState({ micUrl: "mic://" });
    const zoom = {
      id: "z",
      startMs: 2200,
      endMs: 2800,
      level: 2,
      focus: { mode: "fixed" as const, x: 0.5, y: 0.5 },
      easeInMs: 100,
      easeOutMs: 100,
      curve: "linear" as const,
      source: "manual" as const,
    };
    useEditorStore.setState({ zoomRegions: [zoom] });
    const host = fakeHost({
      decodeAudio: vi.fn(async () => ({
        channels: [
          pcm(1000, 3000, [
            [0, 1000],
            [2000, 3000],
          ]),
        ],
        sampleRate: 1000,
        durationMs: 3000,
      })),
    });
    render(<InspectorPanel tab="Effects" host={host} />);
    const open = screen.getByRole("button", { name: "Remove silence…" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    expect(screen.getByText("Would remove 1 gap (00:01 total)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    // The editor store owns clips (persistence writes them over meta.clips).
    const cut = useEditorStore.getState().clips;
    expect(cut.map((c) => [c.sourceStartMs, c.sourceEndMs, c.timelineStartMs])).toEqual([
      [0, 1000, 0],
      [2000, 3000, 1000],
    ]);
    expect(new Set(cut.map((c) => c.id)).size).toBe(2);
    expect(useEditorStore.getState().durationMs).toBe(2000);
    // Items after the cut ripple left with the video.
    expect(useEditorStore.getState().zoomRegions[0]).toMatchObject({ startMs: 1200, endMs: 1800 });
    expect(host.labels).toEqual(["Remove silence"]);
  });

  it("disables remove silence without audio and speeds up idle from telemetry", () => {
    const still: Telemetry["points"] = Array.from(
      { length: 101 },
      (_, i) => [i * 100, 0.5, 0.5, "arrow"] as const,
    );
    setTelemetry({
      points: still,
      clicks: [[5000, 0.5, 0.5, "left", "down"]],
      keys: [],
      scrolls: [],
    });
    const host = fakeHost();
    render(<InspectorPanel tab="Effects" host={host} />);
    expect(screen.getByRole("button", { name: "Remove silence…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Auto speed-up idle" }));
    expect(useEditorStore.getState().speedRegions.map((r) => [r.startMs, r.endMs, r.rate])).toEqual(
      [
        [0, 5000, 3],
        [5000, 10_000, 3],
      ],
    );
    // Running again adds nothing that overlaps.
    fireEvent.click(screen.getByRole("button", { name: "Auto speed-up idle" }));
    expect(useEditorStore.getState().speedRegions).toHaveLength(2);
  });
});

describe("Annotations tab", () => {
  it("detects shortcuts from telemetry keys and adds badges once", () => {
    setTelemetry({
      points: [],
      clicks: [],
      keys: [
        [1000, 0x25, REC_MOD.meta],
        [4000, 0x19, REC_MOD.meta | REC_MOD.shift],
        [6000, 0x02, 0],
      ],
      scrolls: [],
    });
    const host = fakeHost();
    render(<InspectorPanel tab="Annotations" host={host} />);
    expect(screen.getByText("Detected 2 shortcuts")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    const badges = useEditorStore.getState().annotations;
    expect(badges.map((a) => (a.kind === "keystrokeBadge" ? a.label : ""))).toEqual(["⌘K", "⇧⌘P"]);
    expect(host.labels).toEqual(["Add keystroke badges"]);
  });

  it("picks and imports an image source", async () => {
    const img = createAnnotation("image", { id: "img", playheadMs: 0, timelineDurationMs: 42_180 });
    useEditorStore.setState({ annotations: [img], selectedAnnotationId: "img" });
    const host = fakeHost({
      pickFile: vi.fn(async () => "/pics/logo.png"),
      importMedia: vi.fn(async () =>
        media({ path: "media/imported/image/logo.png", hasAudio: false, durationMs: null }),
      ),
    });
    render(<InspectorPanel tab="Annotations" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose image…" }));
    await waitFor(() =>
      expect(useEditorStore.getState().annotations[0]).toMatchObject({
        src: "media/imported/image/logo.png",
      }),
    );
    expect(host.importMedia).toHaveBeenCalledWith("image", "/pics/logo.png");
  });
});

describe("Project tab", () => {
  const withSources = () =>
    resetStores(
      makeMeta({
        clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 21_090, timelineStartMs: 0 }],
        sources: {
          video: makeMeta().sources.video,
          mic: audioSource("media/mic.webm", 42_180),
          capture: { backend: "sck", os: "macOS", scaleFactor: 2, recordedFps: 60 },
        },
      }),
    );

  it("renders session info with stat sizes and trim savings", async () => {
    withSources();
    const host = fakeHost({
      statSources: vi.fn(async () => ({ "media/screen.mp4": { sizeBytes: 2 * 1024 ** 3 } })),
    });
    render(<InspectorPanel tab="Project" host={host} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Demo");
    expect(screen.getByText("ScreenCaptureKit")).toBeInTheDocument();
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Trim source to used range (saves 1 GB)" }),
    ).toBeEnabled();
    expect(host.statSources).toHaveBeenCalledWith(["media/screen.mp4", "media/mic.webm"]);
  });

  it("relinks a source through the host and updates meta + url", async () => {
    withSources();
    useProjectSession.setState({ mediaOffline: true });
    const host = fakeHost({ pickFile: vi.fn(async () => "/new/screen.mp4") });
    render(<InspectorPanel tab="Project" host={host} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Relink media…" })[0] as HTMLElement);
    await waitFor(() => expect(host.relinkMedia).toHaveBeenCalled());
    expect(host.relinkMedia).toHaveBeenCalledWith({
      filePath: "/new/screen.mp4",
      expected: { durationMs: 42_180, width: 3024, height: 1964 },
    });
    await waitFor(() =>
      expect(useProjectSession.getState().meta?.sources.video.path).toBe("media/new.mp4"),
    );
    expect(useProjectSession.getState().videoUrl).toBe("reelform-media://p/media/new.mp4");
    expect(useProjectSession.getState().mediaOffline).toBe(false);
  });

  it("reports relink validation errors", async () => {
    withSources();
    const host = fakeHost({
      pickFile: vi.fn(async () => "/new/other.mp4"),
      relinkMedia: vi.fn(async () => Promise.reject(new Error("Duration doesn't match"))),
    });
    render(<InspectorPanel tab="Project" host={host} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Relink media…" })[0] as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't relink. Duration doesn't match",
    );
  });

  it("trims the source and rewrites clips", async () => {
    withSources();
    const host = fakeHost({
      statSources: vi.fn(async () => ({ "media/screen.mp4": { sizeBytes: 1000 } })),
      trimSource: vi.fn(async () => ({
        clips: [{ id: "c", sourceStartMs: 1000, sourceEndMs: 22_090, timelineStartMs: 0 }],
        videoPath: "media/screen-trimmed.mp4",
        videoDurationMs: 23_090,
        savedBytes: 500,
      })),
    });
    render(<InspectorPanel tab="Project" host={host} />);
    fireEvent.click(await screen.findByRole("button", { name: /Trim source to used range/ }));
    await waitFor(() =>
      expect(useProjectSession.getState().meta?.sources.video.path).toBe(
        "media/screen-trimmed.mp4",
      ),
    );
    expect(useEditorStore.getState().clips[0]?.sourceStartMs).toBe(1000);
    expect(host.labels).toEqual(["Trim source"]);
  });

  it("deletes after confirmation and renames through meta", async () => {
    withSources();
    const host = fakeHost();
    render(<InspectorPanel tab="Project" host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(host.deleteProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(host.deleteProject).toHaveBeenCalledWith({ alsoDeleteRecordings: false });

    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Renamed" } });
    fireEvent.blur(name);
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(useProjectSession.getState().meta?.name).toBe("Renamed"));
  });

  it("shows empty and loading states", () => {
    resetStores(null);
    const { rerender } = render(<InspectorPanel tab="Project" host={fakeHost()} />);
    expect(screen.getByText("No project open")).toBeInTheDocument();
    act(() => useProjectSession.setState({ status: "loading" }));
    rerender(<InspectorPanel tab="Project" host={fakeHost()} />);
    expect(screen.getByText("Loading project…")).toBeInTheDocument();
  });
});

describe("default host", () => {
  it("renders every tab without a host", () => {
    for (const tab of [
      "Frame",
      "Cursor",
      "Zoom",
      "Webcam",
      "Audio",
      "Captions",
      "Annotations",
      "Effects",
      "Project",
    ] as const) {
      const { unmount } = render(<InspectorPanel tab={tab} />);
      unmount();
    }
  });
});
