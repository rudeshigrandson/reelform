import { describe, expect, it, vi } from "vitest";
import {
  NotBridgedError,
  type SystemInvoke,
  createInspectorSystemPort,
} from "./inspectorSystemPort";

type Call = { channel: string; payload: unknown };

function fakeInvoke(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const invoke = (async (channel: string, payload: unknown) => {
    calls.push({ channel, payload });
    return channel in responses ? responses[channel] : null;
  }) as unknown as SystemInvoke;
  return { invoke, calls };
}

const SRT = [{ name: "Subtitles", extensions: ["srt", "vtt"] }] as const;

describe("createInspectorSystemPort", () => {
  it("pickFile forwards title and copies filters; cancel → null", async () => {
    const { invoke, calls } = fakeInvoke({ "system:pickFile": { path: "/Users/me/a.srt" } });
    const port = createInspectorSystemPort(invoke, () => {});
    expect(await port.pickFile({ title: "Import captions", filters: SRT })).toBe("/Users/me/a.srt");
    expect(calls[0]).toEqual({
      channel: "system:pickFile",
      payload: {
        title: "Import captions",
        filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }],
      },
    });

    const cancelled = createInspectorSystemPort(
      fakeInvoke({ "system:pickFile": { path: null } }).invoke,
      () => {},
    );
    expect(await cancelled.pickFile({ title: "x", filters: SRT })).toBeNull();
  });

  it("saveFile asks for a path then writes the contents there", async () => {
    const { invoke, calls } = fakeInvoke({
      "system:saveDialog": { path: "/Users/me/Demo.srt" },
      "system:writeTextFile": { ok: true },
    });
    const port = createInspectorSystemPort(invoke, () => {});
    const saved = await port.saveFile({
      title: "Export captions",
      defaultName: "Demo.srt",
      filters: SRT,
      contents: "1\n00:00:00,000 --> 00:00:01,000\nHi\n",
    });
    expect(saved).toBe("/Users/me/Demo.srt");
    expect(calls.map((c) => c.channel)).toEqual(["system:saveDialog", "system:writeTextFile"]);
    expect(calls[1]?.payload).toEqual({
      path: "/Users/me/Demo.srt",
      contents: "1\n00:00:00,000 --> 00:00:01,000\nHi\n",
    });
  });

  it("saveFile does not write when the dialog is cancelled", async () => {
    const { invoke, calls } = fakeInvoke({ "system:saveDialog": { path: null } });
    const port = createInspectorSystemPort(invoke, () => {});
    expect(
      await port.saveFile({ title: "t", defaultName: "a.vtt", filters: SRT, contents: "WEBVTT" }),
    ).toBeNull();
    expect(calls.map((c) => c.channel)).toEqual(["system:saveDialog"]);
  });

  it("copyIntoProject returns the relative path and statFiles the stats", async () => {
    const { invoke, calls } = fakeInvoke({
      "system:copyIntoProject": { relPath: "media/imported/webcam/cam.mp4" },
      "system:statFiles": {
        stats: { "media/screen.mp4": { sizeBytes: 42 }, "media/mic.m4a": null },
      },
    });
    const port = createInspectorSystemPort(invoke, () => {});
    expect(await port.copyIntoProject("/p/Demo.reelform", "webcam", "/Users/me/cam.mp4")).toBe(
      "media/imported/webcam/cam.mp4",
    );
    expect(await port.statFiles("/p/Demo.reelform", ["media/screen.mp4", "media/mic.m4a"])).toEqual(
      {
        "media/screen.mp4": { sizeBytes: 42 },
        "media/mic.m4a": null,
      },
    );
    expect(calls[1]?.payload).toEqual({
      projectPath: "/p/Demo.reelform",
      relPaths: ["media/screen.mp4", "media/mic.m4a"],
    });
  });

  it("trimSource sends the used hull by path and rewrites clips by the returned offset", async () => {
    const { invoke, calls } = fakeInvoke({
      "project:trimSource": {
        clips: [],
        videoPath: "media/screen-trimmed.mp4",
        videoDurationMs: 12_500,
        savedBytes: 700,
        offsetMs: 8500,
        undoToken: "tok-1",
      },
      "project:restoreTrimmedSource": { ok: true, videoPath: "media/screen.mp4" },
    });
    const port = createInspectorSystemPort(invoke, () => {});
    const res = await port.trimSource("/p/Demo.reelform", [
      { id: "k1", sourceStartMs: 10_000, sourceEndMs: 15_000, timelineStartMs: 0 },
      { id: "k2", sourceStartMs: 17_000, sourceEndMs: 20_000, timelineStartMs: 5000 },
    ]);
    expect(calls[0]).toEqual({
      channel: "project:trimSource",
      payload: {
        path: "/p/Demo.reelform",
        usedRange: { startMs: 10_000, endMs: 20_000 },
        trimLinkedTracks: true,
      },
    });
    expect(res).toEqual({
      clips: [
        { id: "k1", sourceStartMs: 1500, sourceEndMs: 6500, timelineStartMs: 0 },
        { id: "k2", sourceStartMs: 8500, sourceEndMs: 11_500, timelineStartMs: 5000 },
      ],
      videoPath: "media/screen-trimmed.mp4",
      videoDurationMs: 12_500,
      savedBytes: 700,
      undoToken: "tok-1",
      offsetMs: 8500,
    });
    await expect(port.restoreTrimmedSource("/p/Demo.reelform", "tok-1")).resolves.toBeUndefined();
    expect(calls[1]).toEqual({
      channel: "project:restoreTrimmedSource",
      payload: { path: "/p/Demo.reelform", undoToken: "tok-1" },
    });
    await expect(port.trimSource("/p/Demo.reelform", [])).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });

  it("trimSource maps the linked tracks main trimmed, without undefined keys", async () => {
    const { invoke } = fakeInvoke({
      "project:trimSource": {
        clips: [],
        videoPath: "media/screen-trimmed.mp4",
        videoDurationMs: 12_500,
        savedBytes: 2800,
        offsetMs: 8500,
        undoToken: "tok-2",
        linked: {
          mic: { path: "media/mic-trimmed.webm", durationMs: 12_480 },
          webcam: { path: "media/webcam-trimmed.webm", durationMs: 12_500 },
          telemetry: {
            path: "media/telemetry-trimmed.json.gz",
            pointCount: 3,
            hasClicks: true,
            hasKeys: false,
          },
        },
      },
    });
    const port = createInspectorSystemPort(invoke, () => {});
    const res = await port.trimSource("/p/Demo.reelform", [
      { id: "k1", sourceStartMs: 10_000, sourceEndMs: 20_000, timelineStartMs: 0 },
    ]);
    expect(res.linked).toEqual({
      mic: { path: "media/mic-trimmed.webm", durationMs: 12_480 },
      webcam: { path: "media/webcam-trimmed.webm", durationMs: 12_500 },
      telemetry: {
        path: "media/telemetry-trimmed.json.gz",
        pointCount: 3,
        hasClicks: true,
        hasKeys: false,
      },
    });
    expect(Object.keys(res.linked ?? {})).toEqual(["mic", "webcam", "telemetry"]);

    const empty = createInspectorSystemPort(
      fakeInvoke({
        "project:trimSource": {
          clips: [],
          videoPath: "v",
          videoDurationMs: 1,
          savedBytes: 0,
          offsetMs: 0,
          undoToken: "t",
          linked: {},
        },
      }).invoke,
      () => {},
    );
    const plain = await empty.trimSource("/p", [
      { id: "k", sourceStartMs: 0, sourceEndMs: 1, timelineStartMs: 0 },
    ]);
    expect("linked" in plain).toBe(false);
  });

  it("outside Electron: required results throw a coded error, optional ones degrade", async () => {
    const { invoke } = fakeInvoke({});
    const closeWindow = vi.fn();
    const port = createInspectorSystemPort(invoke, closeWindow);
    await expect(port.readTextFile("/a.srt")).rejects.toBeInstanceOf(NotBridgedError);
    await expect(port.copyIntoProject("/p", "audio", "/a.mp3")).rejects.toMatchObject({
      code: "NOT_BRIDGED",
    });
    expect(await port.statFiles("/p", ["media/a"])).toEqual({});
    await expect(
      port.trimSource("/p", [{ id: "k", sourceStartMs: 0, sourceEndMs: 1, timelineStartMs: 0 }]),
    ).rejects.toBeInstanceOf(NotBridgedError);
    await expect(port.restoreTrimmedSource("/p", "t")).rejects.toMatchObject({
      code: "NOT_BRIDGED",
    });
    expect(await port.pickFile({ title: "x", filters: SRT })).toBeNull();
    await expect(port.reveal("/p")).resolves.toBeUndefined();
    port.closeWindow?.();
    expect(closeWindow).toHaveBeenCalledOnce();
  });
});
