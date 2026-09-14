import { describe, expect, it } from "vitest";
import { scriptedSpawn } from "../media/testUtils";
import {
  CaptionsFfmpegError,
  createFfmpegSilenceSplitter,
  createFfmpegWavExtractor,
  parseDurationLine,
  parseSilenceDetect,
  rangesOutputMs,
} from "./ffmpegPorts";

const BINS = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" };

describe("parseSilenceDetect", () => {
  it("pairs start/end lines into spans in ms", () => {
    const lines = [
      "[silencedetect @ 0x1] silence_start: 1.5",
      "[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75",
      "[silencedetect @ 0x1] silence_start: 10",
      "[silencedetect @ 0x1] silence_end: 12.5 | silence_duration: 2.5",
    ];
    expect(parseSilenceDetect(lines, 20_000)).toEqual([
      { startMs: 1500, endMs: 3250 },
      { startMs: 10_000, endMs: 12_500 },
    ]);
  });

  it("clamps negative starts, closes trailing silence at duration, ignores orphan ends", () => {
    const lines = ["silence_end: 1", "silence_start: -0.02", "silence_end: 0.5", "silence_start: 8"];
    expect(parseSilenceDetect(lines, 9000)).toEqual([
      { startMs: 0, endMs: 500 },
      { startMs: 8000, endMs: 9000 },
    ]);
  });

  it("drops an unterminated silence when the duration is unknown", () => {
    expect(parseSilenceDetect(["silence_start: 4"], Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("parseDurationLine / rangesOutputMs", () => {
  it("reads HH:MM:SS.ss", () => {
    expect(parseDurationLine(["Input #0", "  Duration: 01:02:03.50, bitrate: 256 kb/s"])).toBe(
      3_723_500,
    );
    expect(parseDurationLine(["nothing here"])).toBeNull();
  });

  it("divides range length by speed and ignores invalid rates", () => {
    expect(
      rangesOutputMs([
        { startMs: 0, endMs: 2000, rate: 2 },
        { startMs: 5000, endMs: 6000 },
        { startMs: 7000, endMs: 8000, rate: 0 },
      ]),
    ).toBe(3000);
  });
});

describe("createFfmpegWavExtractor", () => {
  it("runs ffmpeg with the extract args and reports clamped progress", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => {
      child.out("out_time_us=1000000\nprogress=continue\n");
      child.out("out_time_us=9000000\nprogress=end\n");
      child.close(0);
    });
    const progress: number[] = [];
    const extract = createFfmpegWavExtractor({ runner: { spawn }, resolveBinaries: () => BINS });
    const res = await extract({
      input: "/p/media/mic.m4a",
      output: "/tmp/a.wav",
      ranges: [{ startMs: 0, endMs: 4000, rate: 2 }],
      onProgress: (f) => progress.push(f),
    });
    expect(res.durationMs).toBe(2000);
    expect(calls[0]?.command).toBe("/bin/ffmpeg");
    expect(calls[0]?.args).toContain("/p/media/mic.m4a");
    expect(calls[0]?.args).toContain("/tmp/a.wav");
    expect(progress).toEqual([0.5, 1]);
  });

  it("throws a coded error when ffmpeg is missing", async () => {
    const extract = createFfmpegWavExtractor({
      runner: { spawn: () => {
        throw new Error("should not spawn");
      } },
      resolveBinaries: () => null,
    });
    await expect(
      extract({ input: "a", output: "b", ranges: [{ startMs: 0, endMs: 1 }] }),
    ).rejects.toBeInstanceOf(CaptionsFfmpegError);
  });
});

describe("createFfmpegSilenceSplitter", () => {
  it("detects silences from stderr, bounded by the reported duration", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => {
      child.err("  Duration: 00:00:30.00, bitrate: 256 kb/s\n");
      child.err("[silencedetect @ 0x] silence_start: 12\n");
      child.err("[silencedetect @ 0x] silence_end: 13.5 | silence_duration: 1.5\n");
      child.err("[silencedetect @ 0x] silence_start: 29\n");
      child.close(0);
    });
    const splitter = createFfmpegSilenceSplitter({ runner: { spawn }, resolveBinaries: () => BINS });
    await expect(splitter.detectSilences({ wavPath: "/tmp/a.wav" })).resolves.toEqual([
      { startMs: 12_000, endMs: 13_500 },
      { startMs: 29_000, endMs: 30_000 },
    ]);
    expect(calls[0]?.args.join(" ")).toContain("silencedetect=noise=-35dB:d=0.5");
  });

  it("cuts a 16 kHz mono PCM chunk for the requested range", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => child.close(0));
    const splitter = createFfmpegSilenceSplitter({ runner: { spawn }, resolveBinaries: () => BINS });
    await splitter.cut({ input: "/tmp/a.wav", output: "/tmp/c0.wav", startMs: 1500, endMs: 301_250 });
    const args = calls[0]?.args ?? [];
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual([
      "-ss",
      "1.500",
      "-to",
      "301.250",
    ]);
    expect(args).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000", "pcm_s16le"]));
    expect(args[args.length - 1]).toBe("/tmp/c0.wav");
  });

  it("propagates a non-zero ffmpeg exit", async () => {
    const { spawn } = scriptedSpawn(({ child }) => {
      child.err("Invalid data found when processing input\n");
      child.close(1);
    });
    const splitter = createFfmpegSilenceSplitter({ runner: { spawn }, resolveBinaries: () => BINS });
    await expect(splitter.detectSilences({ wavPath: "/tmp/bad.wav" })).rejects.toThrow();
  });
});
