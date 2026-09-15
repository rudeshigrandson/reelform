import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TimeSpan } from "./chunks";
import { isCaptionsError } from "./errors";
import { findModel } from "./models";
import { MemFs, argAfter, fakeSpawn } from "./testUtils";
import type { FakeChild } from "./testUtils";
import {
  type TranscribeDeps,
  type TranscribeProgress,
  type TranscribeRequest,
  effectiveLanguage,
  transcribe,
} from "./transcribe";

const fixture = readFileSync(new URL("./__fixtures__/whisper-full.json", import.meta.url), "utf8");
const MIN = 60_000;
const SILENT = JSON.stringify({
  result: { language: "en" },
  transcription: [{ offsets: { from: 0, to: 900 }, text: " [BLANK_AUDIO]" }],
});

const tiny = findModel("tiny.en-q5_1");
const small = findModel("small-q5_1");
if (!tiny || !small) throw new Error("catalog missing models");

interface Setup {
  durationMs?: number;
  silences?: TimeSpan[];
  /** JSON per chunk index; default: the fixture. */
  jsonFor?: (index: number) => string | null;
  childScript?: (args: readonly string[], child: FakeChild, fs: MemFs) => void;
  modelInstalled?: boolean;
}

function setup(o: Setup = {}) {
  const fs = new MemFs();
  if (o.modelInstalled !== false) fs.writeText("/models/model.bin", "ggml");
  const cuts: { startMs: number; endMs: number; output: string }[] = [];
  const extractCalls: unknown[] = [];
  let detectCalls = 0;
  const { spawn, calls } = fakeSpawn((args, child) => {
    if (o.childScript) return o.childScript(args, child, fs);
    const outBase = argAfter(args, "-of");
    const index = Number(/chunk-(\d+)$/.exec(outBase)?.[1]);
    child.emit("stderr", "progress = 50%\n");
    const json = o.jsonFor ? o.jsonFor(index) : fixture;
    if (json !== null) fs.writeText(`${outBase}.json`, json);
    child.emit("close", 0, null);
  });
  const deps: TranscribeDeps = {
    join: (...p) => p.join("/"),
    fs,
    tempPrefix: "/tmp/cap-",
    spawn,
    extractWav: async (req) => {
      extractCalls.push(req);
      req.onProgress?.(0.5);
      fs.writeText(req.output, "RIFF");
      return { durationMs: o.durationMs ?? 7200 };
    },
    splitter: {
      detectSilences: async () => {
        detectCalls++;
        return o.silences ?? [];
      },
      cut: async (req) => {
        cuts.push({ startMs: req.startMs, endMs: req.endMs, output: req.output });
        fs.writeText(req.output, "RIFF");
      },
    },
    threads: 2,
  };
  return { fs, deps, calls, cuts, extractCalls, detectCalls: () => detectCalls };
}

const request = (over: Partial<TranscribeRequest> = {}): TranscribeRequest => ({
  input: "/p/media/mic.m4a",
  ranges: [{ startMs: 0, endMs: 7200 }],
  model: small,
  modelPath: "/models/model.bin",
  whisperBin: "/bin/whisper-cli",
  ...over,
});

describe("transcribe", () => {
  it("runs extract → whisper → segment for a short range", async () => {
    const s = setup();
    const progress: TranscribeProgress[] = [];
    const res = await transcribe(
      request({ language: "de", onProgress: (p) => progress.push(p) }),
      s.deps,
    );

    expect(res.language).toBe("en");
    expect(res.durationMs).toBe(7200);
    expect(res.captions.map((c) => c.text)).toEqual([
      "Welcome to Reelform.",
      "Hit record, then let auto-zoom do the\nrest!",
    ]);
    expect(s.detectCalls()).toBe(0);
    expect(s.cuts).toEqual([]);
    expect(s.calls).toHaveLength(1);
    const args = s.calls[0]?.args ?? [];
    expect(argAfter(args, "-f")).toBe("/tmp/cap-0/audio.wav");
    expect(argAfter(args, "-l")).toBe("de");
    expect(argAfter(args, "-m")).toBe("/models/model.bin");
    expect(args).toContain("--output-json-full");
    expect(s.extractCalls[0]).toMatchObject({
      input: "/p/media/mic.m4a",
      ranges: [{ startMs: 0, endMs: 7200 }],
    });

    expect(progress.map((p) => p.stage)).toEqual([
      "extracting",
      "extracting",
      "transcribing",
      "transcribing",
      "segmenting",
    ]);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]?.progress).toBeGreaterThanOrEqual(progress[i - 1]?.progress ?? 0);
    }
    expect(progress.at(-1)).toMatchObject({ progress: 1, doneMs: 7200, totalMs: 7200 });
    // Temp dir cleaned up.
    expect(s.fs.dirs.size).toBe(0);
    expect([...s.fs.files.keys()].filter((k) => k.startsWith("/tmp/"))).toEqual([]);
  });

  it("splits long audio into ≤5 min chunks and offsets words by chunk start", async () => {
    const s = setup({
      durationMs: 12 * MIN,
      silences: [{ startMs: 4 * MIN, endMs: 4 * MIN + 2000 }],
    });
    const res = await transcribe(request(), s.deps);
    expect(s.cuts.map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 4 * MIN + 1000],
      [4 * MIN + 1000, 9 * MIN + 1000],
      [9 * MIN + 1000, 12 * MIN],
    ]);
    expect(s.calls.map((c) => argAfter(c.args, "-f"))).toEqual(s.cuts.map((c) => c.output));
    const starts = res.captions.map((c) => c.startMs);
    expect(starts).toEqual([
      0,
      4000,
      4 * MIN + 1000,
      4 * MIN + 5000,
      9 * MIN + 1000,
      9 * MIN + 5000,
    ]);
    const words = res.captions.flatMap((c) => c.words);
    for (let i = 1; i < words.length; i++)
      expect(words[i]?.t0).toBeGreaterThanOrEqual(words[i - 1]?.t0 ?? 0);
  });

  it("drops words a chunk reports past its end", async () => {
    // Silence midpoint at 299_000ms → first chunk is [0, 299_000]; whisper reports a word beyond it.
    const late = JSON.stringify({
      transcription: [
        {
          offsets: { from: 298_000, to: 301_000 },
          text: " edge past",
          tokens: [
            { text: " edge", offsets: { from: 298_000, to: 299_500 } },
            { text: " past", offsets: { from: 299_500, to: 301_000 } },
          ],
        },
      ],
    });
    const s2 = setup({
      durationMs: 5 * MIN + 3000,
      silences: [{ startMs: 5 * MIN - 1000, endMs: 5 * MIN - 1000 }],
      jsonFor: (i) => (i === 0 ? late : SILENT),
    });
    const res = await transcribe(request(), s2.deps);
    const words = res.captions.flatMap((c) => c.words);
    expect(words).toEqual([{ text: "edge", t0: 298_000, t1: 299_000 }]);
  });

  it("throws no-speech when whisper finds no words", async () => {
    const s = setup({ jsonFor: () => SILENT });
    await expect(transcribe(request(), s.deps)).rejects.toMatchObject({ code: "no-speech" });
    expect(s.fs.dirs.size).toBe(0);
  });

  it("throws no-speech for zero-length audio without spawning whisper", async () => {
    const s = setup({ durationMs: 0 });
    await expect(transcribe(request(), s.deps)).rejects.toMatchObject({ code: "no-speech" });
    expect(s.calls).toHaveLength(0);
  });

  it("requires an installed model", async () => {
    const s = setup({ modelInstalled: false });
    await expect(transcribe(request(), s.deps)).rejects.toMatchObject({
      code: "model-not-installed",
    });
  });

  it("maps extractor and splitter failures to stable codes", async () => {
    const s = setup();
    s.deps.extractWav = async () => {
      throw new Error("ffmpeg exited 1");
    };
    await expect(transcribe(request(), s.deps)).rejects.toMatchObject({ code: "extract-failed" });
    expect(s.fs.dirs.size).toBe(0);

    const t = setup({ durationMs: 11 * MIN });
    t.deps.splitter.detectSilences = async () => {
      throw new Error("boom");
    };
    await expect(transcribe(request(), t.deps)).rejects.toMatchObject({ code: "split-failed" });
  });

  it("reports whisper-output-invalid when no JSON is written", async () => {
    const s = setup({ jsonFor: () => null });
    await expect(transcribe(request(), s.deps)).rejects.toMatchObject({
      code: "whisper-output-invalid",
    });
  });

  it("propagates whisper failures and cancellation, cleaning up", async () => {
    const s = setup({ childScript: (_a, child) => child.emit("close", 1, null) });
    await expect(transcribe(request(), s.deps)).rejects.toMatchObject({ code: "whisper-failed" });
    expect(s.fs.dirs.size).toBe(0);

    const controller = new AbortController();
    const c = setup({ childScript: () => controller.abort() });
    try {
      await transcribe(request({ signal: controller.signal }), c.deps);
      expect.unreachable();
    } catch (err) {
      expect(isCaptionsError(err, "cancelled")).toBe(true);
    }
    expect(c.fs.dirs.size).toBe(0);
  });

  it("forces English for .en models", () => {
    expect(effectiveLanguage(tiny, "fr")).toBe("en");
    expect(effectiveLanguage(small, undefined)).toBe("auto");
    expect(effectiveLanguage(small, "")).toBe("auto");
    expect(effectiveLanguage(small, "ja")).toBe("ja");
  });
});
