import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionsProgressEvent } from "../../editor/inspector/host/types";
import { initialProjectSession, useProjectSession } from "../project/session";
import {
  type InvokeFn,
  type OnEventFn,
  type SystemPort,
  createCaptionsPort,
  createInspectorHost,
  mediaUrlFor,
} from "./createInspectorHost";

type Handler = (payload: unknown) => unknown;

function fakeIpc(handlers: Record<string, Handler>) {
  const calls: [string, unknown][] = [];
  const listeners = new Map<string, (p: unknown) => void>();
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    calls.push([channel, payload]);
    const h = handlers[channel];
    if (!h) throw new Error(`unexpected channel ${channel}`);
    return h(payload);
  }) as unknown as InvokeFn;
  const onEvent = vi.fn((channel: string, cb: (p: unknown) => void) => {
    listeners.set(channel, cb);
    return () => listeners.delete(channel);
  }) as unknown as OnEventFn;
  return {
    invoke,
    onEvent,
    calls,
    fire: (ch: string, p: unknown) => listeners.get(ch)?.(p),
    listeners,
  };
}

function system(over: Partial<SystemPort> = {}): SystemPort {
  return {
    pickFile: vi.fn(async () => "/picked"),
    saveFile: vi.fn(async () => "/saved"),
    readTextFile: vi.fn(async () => "text"),
    reveal: vi.fn(async () => {}),
    copyIntoProject: vi.fn(
      async (_root, kind, src) => `media/imported/${kind}/${src.split("/").pop()}`,
    ),
    statFiles: vi.fn(async () => ({ "media/a.mp4": { sizeBytes: 5 } })),
    ...over,
  };
}

const session = { projectPath: "/P/Demo.reelform", mediaBaseUrl: "reelform-media://root/" };

beforeEach(() => {
  useProjectSession.setState(initialProjectSession());
});

describe("createCaptionsPort", () => {
  it("maps models, download, cancel and transcribe onto captions:* channels", async () => {
    const ipc = fakeIpc({
      "captions:models": () => [
        {
          id: "tiny.en-q5_1",
          tier: "fast",
          label: "Fast",
          displaySize: "32 MB",
          sizeBytes: 1,
          installed: true,
          partialBytes: 0,
          downloading: false,
        },
      ],
      "captions:download": (p) => ({
        model: (p as { model: string }).model,
        path: "/m",
        verified: true,
        alreadyInstalled: false,
      }),
      "captions:cancelDownload": () => ({ cancelled: true }),
      "captions:transcribe": () => ({
        captions: [{ id: "c", startMs: 0, endMs: 1, text: "hi", words: [] }],
        language: "en",
        durationMs: 1,
      }),
    });
    const port = createCaptionsPort(ipc.invoke, ipc.onEvent);
    expect(await port.models()).toEqual([
      { id: "tiny.en-q5_1", installed: true, downloading: false, displaySize: "32 MB" },
    ]);
    await port.download("base-q5_1");
    await port.cancelDownload("base-q5_1");
    const res = await port.transcribe({
      jobId: "j1",
      audioPath: "/P/mic.webm",
      ranges: [
        { startMs: 0, endMs: 1000 },
        { startMs: 1000, endMs: 2000, rate: 2 },
      ],
      model: "small-q5_1",
      language: "auto",
    });
    expect(res.captions).toHaveLength(1);
    expect(ipc.calls).toEqual([
      ["captions:models", undefined],
      ["captions:download", { model: "base-q5_1" }],
      ["captions:cancelDownload", { model: "base-q5_1" }],
      [
        "captions:transcribe",
        {
          jobId: "j1",
          audio: { path: "/P/mic.webm" },
          ranges: [
            { startMs: 0, endMs: 1000 },
            { startMs: 1000, endMs: 2000, rate: 2 },
          ],
          model: "small-q5_1",
          language: "auto",
        },
      ],
    ]);
  });

  it("forwards progress events and unsubscribes", () => {
    const ipc = fakeIpc({});
    const port = createCaptionsPort(ipc.invoke, ipc.onEvent);
    const seen: CaptionsProgressEvent[] = [];
    const off = port.onProgress((e) => seen.push(e));
    ipc.fire("captions:progress", {
      kind: "download",
      taskId: "m",
      receivedBytes: 5,
      totalBytes: 10,
      progress: 0.5,
    });
    ipc.fire("captions:progress", {
      kind: "transcribe",
      taskId: "j",
      stage: "transcribing",
      progress: 0.3,
      doneMs: 3,
      totalMs: 10,
    });
    expect(seen).toEqual([
      { kind: "download", taskId: "m", progress: 0.5 },
      { kind: "transcribe", taskId: "j", progress: 0.3, doneMs: 3, totalMs: 10 },
    ]);
    off();
    expect(ipc.listeners.size).toBe(0);
  });

  it("rejects when IPC is unavailable (null response)", async () => {
    const ipc = fakeIpc({ "captions:models": () => null, "captions:transcribe": () => null });
    const port = createCaptionsPort(ipc.invoke, ipc.onEvent);
    await expect(port.models()).rejects.toMatchObject({ code: "ipc-unavailable" });
  });
});

describe("createInspectorHost", () => {
  const make = (handlers: Record<string, Handler>, sys = system()) => {
    const ipc = fakeIpc(handlers);
    const host = createInspectorHost({
      system: sys,
      invoke: ipc.invoke,
      onEvent: ipc.onEvent,
      decodeAudio: vi.fn(async () => null),
      documentUpdate: vi.fn(),
      metaUpdate: vi.fn(),
      platform: "win",
      getSession: () => session,
    });
    return { host, ipc, sys };
  };

  it("imports media: copies into the project, probes, builds a media URL", async () => {
    const { host, ipc } = make({
      "media:probe": () => ({
        durationMs: 4000,
        width: 1280,
        height: 720,
        fps: 30,
        codec: "h264",
        hasAudio: true,
      }),
    });
    const res = await host.importMedia("webcam", "/Users/me/my cam.mov");
    expect(res).toEqual({
      path: "media/imported/webcam/my cam.mov",
      url: "reelform-media://root/media/imported/webcam/my%20cam.mov",
      durationMs: 4000,
      width: 1280,
      height: 720,
      hasAudio: true,
    });
    expect(ipc.calls).toEqual([["media:probe", { path: "/Users/me/my cam.mov" }]]);
    const img = await host.importMedia("image", "/pics/logo.png");
    expect(img.durationMs).toBeNull();
    expect(ipc.calls).toHaveLength(1);
  });

  it("import tolerates probe failure", async () => {
    const { host } = make({
      "media:probe": () => {
        throw new Error("no ffprobe");
      },
    });
    const res = await host.importMedia("audio", "/a/song.mp3");
    expect(res).toMatchObject({ durationMs: null, hasAudio: true });
  });

  it("relinks via project:relink with only the provided expectations", async () => {
    const { host, ipc } = make({
      "project:relink": () => ({
        path: "media/screen.mp4",
        probe: { durationMs: 1, width: 1, height: 1 },
      }),
    });
    expect(await host.relinkMedia({ filePath: "/x.webm", expected: { durationMs: 900 } })).toEqual({
      path: "media/screen.mp4",
      url: "reelform-media://root/media/screen.mp4",
    });
    expect(ipc.calls[0]).toEqual([
      "project:relink",
      { path: "/P/Demo.reelform", filePath: "/x.webm", expected: { durationMs: 900 } },
    ]);
  });

  it("deletes via project:trash and closes the window", async () => {
    const closeWindow = vi.fn();
    const { host, ipc } = make(
      { "project:trash": () => ({ trashed: true }) },
      system({ closeWindow }),
    );
    await host.deleteProject({ alsoDeleteRecordings: true });
    expect(ipc.calls).toEqual([["project:trash", { path: "/P/Demo.reelform" }]]);
    expect(closeWindow).toHaveBeenCalled();
  });

  it("delegates system ports, stat and trim; trim is null when unsupported", async () => {
    const { host, sys } = make({});
    expect(await host.pickFile({ title: "t", filters: [] })).toBe("/picked");
    expect(await host.statSources(["media/a.mp4"])).toEqual({ "media/a.mp4": { sizeBytes: 5 } });
    expect(sys.statFiles).toHaveBeenCalledWith("/P/Demo.reelform", ["media/a.mp4"]);
    expect(await host.trimSource([])).toBeNull();
    expect(host.platform).toBe("win");
  });

  it("copies fonts and cursors like images and click sounds like audio", async () => {
    const { host, sys, ipc } = make({
      "media:probe": () => ({ durationMs: 120, width: 0, height: 0, hasAudio: true }),
    });
    expect(await host.importMedia("font", "/f/Brand.ttf")).toEqual({
      path: "media/imported/image/Brand.ttf",
      url: "reelform-media://root/media/imported/image/Brand.ttf",
      durationMs: null,
      width: null,
      height: null,
      hasAudio: false,
    });
    expect(sys.copyIntoProject).toHaveBeenLastCalledWith(
      "/P/Demo.reelform",
      "image",
      "/f/Brand.ttf",
    );
    await host.importMedia("cursor", "/c/arrow.svg");
    expect(sys.copyIntoProject).toHaveBeenLastCalledWith(
      "/P/Demo.reelform",
      "image",
      "/c/arrow.svg",
    );
    expect(ipc.calls).toEqual([]);
    const sound = await host.importMedia("sound", "/s/click.wav");
    expect(sys.copyIntoProject).toHaveBeenLastCalledWith(
      "/P/Demo.reelform",
      "audio",
      "/s/click.wav",
    );
    expect(sound).toMatchObject({ path: "media/imported/audio/click.wav", hasAudio: true });
  });

  it("exposes restoreTrimmedSource only when the system port supports it", async () => {
    expect(make({}).host.restoreTrimmedSource).toBeUndefined();
    const restoreTrimmedSource = vi.fn(async () => {});
    const { host } = make({}, system({ restoreTrimmedSource }));
    await host.restoreTrimmedSource?.("tok-1");
    expect(restoreTrimmedSource).toHaveBeenCalledWith("/P/Demo.reelform", "tok-1");
  });

  it("fails clearly without an open project", async () => {
    const ipc = fakeIpc({});
    const host = createInspectorHost({
      system: system(),
      invoke: ipc.invoke,
      onEvent: ipc.onEvent,
      documentUpdate: vi.fn(),
      metaUpdate: vi.fn(),
    });
    await expect(host.importMedia("audio", "/a.mp3")).rejects.toMatchObject({ code: "no-project" });
    expect(await host.statSources(["x"])).toEqual({});
  });
});

describe("mediaUrlFor", () => {
  it("encodes segments and refuses absolute paths", () => {
    expect(mediaUrlFor("base://", "media/a b/#1.mp4")).toBe("base://media/a%20b/%231.mp4");
    expect(mediaUrlFor("base://", "/abs.mp4")).toBeNull();
    expect(mediaUrlFor("base://", "C:\\abs.mp4")).toBeNull();
    expect(mediaUrlFor(null, "media/a.mp4")).toBeNull();
  });
});
