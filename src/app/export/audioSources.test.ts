import { describe, expect, it, vi } from "vitest";
import { createFakeContext, fakeBuffer } from "../../editor/audio/fakeAudioContext";
import { framesFor } from "../../editor/audio/render";
import type { OfflineContextFactory } from "../../editor/audio/render";
import { initialEditorData } from "../../editor/store";
import { type AudioDecodePort, createExportAudioRenderer, loadAudioSources } from "./audioSources";

const decoder = (fail: string[] = []): AudioDecodePort => ({
  decode: vi.fn(async (url: string) => {
    if (fail.includes(url)) throw new Error("decode failed");
    return fakeBuffer(40);
  }),
});

const createContext: OfflineContextFactory = (o) =>
  createFakeContext(o.sampleRate, { length: o.length, channels: 2 });

describe("loadAudioSources", () => {
  it("decodes available tracks and reports undecodable ones", async () => {
    const d = decoder(["sys.m4a"]);
    const res = await loadAudioSources(
      { micUrl: "mic.m4a", systemAudioUrl: "sys.m4a" },
      d,
      new AbortController().signal,
    );
    expect(res.sources.mic).toBeDefined();
    expect(res.sources.system).toBeUndefined();
    expect(res.failed).toEqual(["system"]);
  });

  it("skips missing URLs and rethrows when aborted", async () => {
    const none = await loadAudioSources(
      { micUrl: null, systemAudioUrl: null },
      decoder(),
      new AbortController().signal,
    );
    expect(none).toEqual({ sources: {}, failed: [] });
    const ac = new AbortController();
    ac.abort();
    await expect(
      loadAudioSources(
        { micUrl: "mic.m4a", systemAudioUrl: null },
        decoder(["mic.m4a"]),
        ac.signal,
      ),
    ).rejects.toThrow("decode failed");
  });
});

describe("createExportAudioRenderer", () => {
  it("renders exactly the frame plan's output duration", async () => {
    const onDecodeFailed = vi.fn();
    const render = createExportAudioRenderer({
      urls: { micUrl: "mic.m4a", systemAudioUrl: "sys.m4a" },
      settings: initialEditorData().audio,
      clips: [{ id: "c", sourceStartMs: 0, sourceEndMs: 40_000, timelineStartMs: 0 }],
      speeds: [],
      decoder: decoder(["sys.m4a"]),
      createContext,
      onDecodeFailed,
    });
    const out = await render({
      range: { startMs: 2000, endMs: 35_000 },
      outputDurationMs: 33_000,
      signal: new AbortController().signal,
    });
    expect(out?.length).toBe(framesFor(33_000, 48_000));
    expect(onDecodeFailed).toHaveBeenCalledWith(["system"]);
  });

  it("returns null when the project has no audio tracks", async () => {
    const render = createExportAudioRenderer({
      urls: { micUrl: null, systemAudioUrl: null },
      settings: initialEditorData().audio,
      clips: [],
      speeds: [],
      decoder: decoder(),
      createContext,
    });
    await expect(
      render({
        range: { startMs: 0, endMs: 1000 },
        outputDurationMs: 1000,
        signal: new AbortController().signal,
      }),
    ).resolves.toBeNull();
  });
});
