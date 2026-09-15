import fc from "fast-check";
import {
  atempoChain,
  buildExtractWavArgs,
  buildRemuxToMp4Args,
  buildThumbnailArgs,
  buildTranscodeToH264Args,
  buildTrimSourceArgs,
  buildWavFilterGraph,
  extractedDurationMs,
  filmstripArgs,
  muxAudioArgs,
  proxyArgs,
  sec,
  thumbnailArgs,
  trimCopyArgs,
  trimWindow,
  usedSourceRange,
} from "./args";
import {
  buildListEncodersArgs,
  hardwareH264Candidates,
  parseEncoderList,
  selectH264Encoder,
  videoEncoderArgs,
} from "./encoders";

const argAfter = (args: readonly string[], flag: string): string | undefined =>
  args[args.indexOf(flag) + 1];

describe("sec", () => {
  it("formats ms as seconds", () => {
    expect(sec(0)).toBe("0");
    expect(sec(1500)).toBe("1.5");
    expect(sec(1234.4)).toBe("1.234");
    expect(sec(-5)).toBe("0");
  });
});

describe("remux / transcode", () => {
  it("remux copies streams into faststart mp4 with progress on stdout", () => {
    const a = buildRemuxToMp4Args("/r/in.webm", "/r/out.mp4");
    expect(argAfter(a, "-c")).toBe("copy");
    expect(argAfter(a, "-progress")).toBe("pipe:1");
    expect(a.at(-1)).toBe("/r/out.mp4");
    expect(argAfter(a, "-i")).toBe("/r/in.webm");
  });

  it("VP9→H.264 transcode uses the selected encoder, bt709, aac, optional audio map", () => {
    const a = buildTranscodeToH264Args({
      input: "i.webm",
      output: "o.mp4",
      encoder: "h264_videotoolbox",
      fps: 60,
      bitrateKbps: 16000,
    });
    expect(argAfter(a, "-c:v")).toBe("h264_videotoolbox");
    expect(argAfter(a, "-b:v")).toBe("16000k");
    expect(argAfter(a, "-g")).toBe("120");
    expect(argAfter(a, "-colorspace")).toBe("bt709");
    expect(argAfter(a, "-c:a")).toBe("aac");
    expect(a).toContain("0:a?");
  });
});

describe("encoders", () => {
  const encodersOutput = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
`;

  it("parses the encoder list after the separator", () => {
    const set = parseEncoderList(encodersOutput);
    expect([...set]).toEqual(["libx264", "h264_videotoolbox", "h264_nvenc", "aac"]);
    expect(buildListEncodersArgs()).toContain("-encoders");
  });

  it("selects per-platform hardware, skipping rejected, else libx264", () => {
    const all = new Set(["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "libx264"]);
    expect(selectH264Encoder("darwin", all)).toBe("h264_videotoolbox");
    expect(selectH264Encoder("win32", all)).toBe("h264_nvenc");
    expect(selectH264Encoder("win32", all, { rejected: new Set(["h264_nvenc"]) })).toBe("h264_qsv");
    expect(selectH264Encoder("win32", new Set(["h264_amf"]))).toBe("h264_amf");
    expect(selectH264Encoder("linux", new Set(["h264_amf"]))).toBe("libx264");
    expect(selectH264Encoder("darwin", all, { preferSoftware: true })).toBe("libx264");
    expect(hardwareH264Candidates("freebsd")).toEqual([]);
  });

  it("libx264 without bitrate uses CRF; every encoder emits yuv420p + 2s GOP", () => {
    const x = videoEncoderArgs({ encoder: "libx264", fps: 30 });
    expect(argAfter(x, "-crf")).toBe("18");
    expect(x).not.toContain("-b:v");
    for (const encoder of [
      "h264_videotoolbox",
      "h264_nvenc",
      "h264_qsv",
      "h264_amf",
      "libx264",
    ] as const) {
      for (const bitrateKbps of [undefined, 8000]) {
        const a = videoEncoderArgs({ encoder, fps: 30, bitrateKbps });
        expect(argAfter(a, "-pix_fmt")).toBe("yuv420p");
        expect(argAfter(a, "-g")).toBe("60");
        expect(a.includes("-b:v")).toBe(bitrateKbps !== undefined);
      }
    }
  });
});

describe("captions WAV extraction (§9.6)", () => {
  it("single range: atrim → re-zero → 16 kHz mono s16", () => {
    const g = buildWavFilterGraph([{ startMs: 1000, endMs: 2500 }]);
    expect(g).toBe(
      "[0:a:0]atrim=start=1:end=2.5,asetpts=PTS-STARTPTS[a0];[a0]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono[out]",
    );
  });

  it("multiple ranges are concatenated in order with speed applied", () => {
    const g = buildWavFilterGraph(
      [
        { startMs: 0, endMs: 1000 },
        { startMs: 5000, endMs: 9000, rate: 4 },
      ],
      1,
    );
    expect(g).toContain("[0:a:1]atrim=start=5:end=9,asetpts=PTS-STARTPTS,atempo=2,atempo=2[a1]");
    expect(g).toContain("[a0][a1]concat=n=2:v=0:a=1,aresample=16000");
  });

  it("args map the graph output to pcm wav", () => {
    const a = buildExtractWavArgs({
      input: "/m/mic.webm",
      output: "/tmp/c.wav",
      ranges: [{ startMs: 0, endMs: 10 }],
    });
    expect(argAfter(a, "-map")).toBe("[out]");
    expect(argAfter(a, "-ar")).toBe("16000");
    expect(argAfter(a, "-ac")).toBe("1");
    expect(argAfter(a, "-c:a")).toBe("pcm_s16le");
  });

  it("rejects empty and inverted ranges", () => {
    expect(() => buildWavFilterGraph([])).toThrow(
      expect.objectContaining({ code: "MEDIA_INVALID_ARGS" }),
    );
    expect(() => buildWavFilterGraph([{ startMs: 5, endMs: 5 }])).toThrow(/invalid range/);
    expect(() => buildWavFilterGraph([{ startMs: 0, endMs: 5, rate: 0 }])).toThrow(/rate/);
  });

  it("extracted duration accounts for speed", () => {
    expect(
      extractedDurationMs([
        { startMs: 0, endMs: 1000 },
        { startMs: 0, endMs: 2000, rate: 2 },
      ]),
    ).toBe(2000);
  });

  it("property: atempo factors multiply to the rate and each is within [0.5, 2]", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 64, noNaN: true }), (rate) => {
        const factors = atempoChain(rate).map((f) => Number(f.slice("atempo=".length)));
        for (const f of factors) {
          expect(f).toBeGreaterThanOrEqual(0.5);
          expect(f).toBeLessThanOrEqual(2);
        }
        const product = factors.reduce((a, b) => a * b, 1);
        expect(Math.abs(product - rate) / rate).toBeLessThan(1e-5);
      }),
    );
  });
});

describe("trim source to used range (§9.9)", () => {
  it("hull of clips", () => {
    expect(usedSourceRange([])).toBeNull();
    expect(
      usedSourceRange([
        { sourceStartMs: 5000, sourceEndMs: 6000 },
        { sourceStartMs: 2000, sourceEndMs: 3000 },
      ]),
    ).toEqual({ startMs: 2000, endMs: 6000 });
  });

  it("adds 1s handles clamped to the source", () => {
    expect(trimWindow({ startMs: 2000, endMs: 6000 }, 10000)).toEqual({
      startMs: 1000,
      endMs: 7000,
    });
    expect(trimWindow({ startMs: 300, endMs: 9800 }, 10000)).toEqual({ startMs: 0, endMs: 10000 });
  });

  it("builds a stream-copy cut and returns the window", () => {
    const { args, window } = buildTrimSourceArgs({
      input: "in.mp4",
      output: "media/trim.mp4",
      used: { startMs: 2000, endMs: 6000 },
      sourceDurationMs: 10000,
    });
    expect(window).toEqual({ startMs: 1000, endMs: 7000 });
    expect(argAfter(args, "-ss")).toBe("1");
    expect(argAfter(args, "-t")).toBe("6");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(argAfter(args, "-c")).toBe("copy");
  });

  it("property: window contains the used range and stays inside the source", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e7 }),
        fc.integer({ min: 0, max: 1e7 }),
        fc.integer({ min: 1, max: 1e7 }),
        (dur, s, len) => {
          const start = Math.min(s, dur - 1);
          const end = Math.min(start + len, dur);
          const w = trimWindow({ startMs: start, endMs: end }, dur);
          expect(w.startMs).toBeLessThanOrEqual(start);
          expect(w.endMs).toBeGreaterThanOrEqual(end);
          expect(w.startMs).toBeGreaterThanOrEqual(0);
          expect(w.endMs).toBeLessThanOrEqual(dur);
          expect(start - w.startMs).toBeLessThanOrEqual(1000);
        },
      ),
    );
  });
});

describe("thumbnail args", () => {
  it("seeks before input, one frame to stdout, even scaled width", () => {
    const a = buildThumbnailArgs({ input: "/p/a.mp4", atMs: 2500, width: 321 });
    expect(argAfter(a, "-ss")).toBe("2.5");
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(argAfter(a, "-frames:v")).toBe("1");
    expect(argAfter(a, "-vf")).toBe("scale=322:-2");
    expect(argAfter(a, "-c:v")).toBe("png");
    expect(a.at(-1)).toBe("pipe:1");
    expect(a).not.toContain("-progress");
    expect(argAfter(buildThumbnailArgs({ input: "x", atMs: 0, format: "jpg" }), "-c:v")).toBe(
      "mjpeg",
    );
  });
});

describe("mux / proxy / filmstrip / thumbnail file", () => {
  it("muxAudioArgs copies video and encodes AAC faststart for mp4", () => {
    const a = muxAudioArgs({
      video: "/e/v.mp4",
      wav: "/e/a.wav",
      output: "/e/t.mp4",
      container: "mp4",
    });
    expect(a.slice(a.indexOf("-i"))).toEqual([
      "-i",
      "/e/v.mp4",
      "-i",
      "/e/a.wav",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "/e/t.mp4",
    ]);
  });

  it("muxAudioArgs uses libopus and no faststart for webm", () => {
    const a = muxAudioArgs({
      video: "/v.webm",
      wav: "/a.wav",
      output: "/t.webm",
      container: "webm",
    });
    expect(argAfter(a, "-c:a")).toBe("libopus");
    expect(a).not.toContain("-movflags");
    expect(argAfter(a, "-f")).toBe("webm");
  });

  it("proxyArgs scales to 1080p x264 veryfast crf 23 without audio", () => {
    const a = proxyArgs({ input: "/p/in.mov", output: "/p/cache/proxy.partial.mp4" });
    expect(argAfter(a, "-vf")).toBe("scale=-2:1080");
    expect(argAfter(a, "-c:v")).toBe("libx264");
    expect(argAfter(a, "-preset")).toBe("veryfast");
    expect(argAfter(a, "-crf")).toBe("23");
    expect(a).toContain("-an");
    expect(a.at(-1)).toBe("/p/cache/proxy.partial.mp4");
  });

  it("filmstripArgs samples every interval at an even height into a numbered pattern", () => {
    const a = filmstripArgs({
      input: "/in.mp4",
      outputDir: "/c/thumbs",
      intervalMs: 2000,
      height: 160,
    });
    expect(argAfter(a, "-vf")).toBe("fps=1/2,scale=-2:160");
    expect(a.at(-1)).toBe("/c/thumbs/%06d.jpg");
    expect(
      argAfter(filmstripArgs({ input: "/i", outputDir: "/o", intervalMs: 500, height: 91 }), "-vf"),
    ).toBe("fps=1/0.5,scale=-2:92");
    expect(() =>
      filmstripArgs({ input: "/i", outputDir: "/o", intervalMs: 0, height: 160 }),
    ).toThrow();
    expect(() =>
      filmstripArgs({ input: "/i", outputDir: "/o", intervalMs: 1000, height: Number.NaN }),
    ).toThrow();
  });

  it("thumbnailArgs writes one frame to a file; trimCopyArgs is the trim builder", () => {
    const a = thumbnailArgs({
      input: "/in.mp4",
      output: "/p/thumbnail.jpg",
      atMs: 1500,
      width: 641,
    });
    expect(argAfter(a, "-ss")).toBe("1.5");
    expect(argAfter(a, "-vf")).toBe("scale=642:-2");
    expect(a.at(-1)).toBe("/p/thumbnail.jpg");
    expect(trimCopyArgs).toBe(buildTrimSourceArgs);
  });
});
