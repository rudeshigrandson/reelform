import { describe, expect, it, vi } from "vitest";
import { ExportCancelledError } from "../../export/engine/cancel";
import { EncoderUnsupportedError } from "../../export/engine/encoderConfig";
import { EncoderFailure } from "../../export/engine/engine";
import { type ExportFlowConfig, defaultFlowConfig } from "./config";
import {
  type Caption,
  type ExportFlowPhase,
  type ExportRequest,
  type ExportRunnerDeps,
  type GifRouteArgs,
  type VideoRouteArgs,
  captionsForOutput,
  createExportRunner,
  isLowDisk,
  progressPatchFor,
} from "./runner";
import { FakeFlowSink, deferred, fakeSystemPort, progressAt } from "./testFakes";
import { initialExportProgress, progressRingValue } from "./useExportProgress";

const cap = (id: string, startMs: number, endMs: number, text = id): Caption =>
  ({ id, startMs, endMs, text, words: [] }) as unknown as Caption;

function request(
  config: Partial<ExportFlowConfig> = {},
  extra: Partial<ExportRequest> = {},
): ExportRequest {
  return {
    config: { ...defaultFlowConfig("Demo"), ...config },
    projectId: "p1",
    range: { startMs: 0, endMs: 10_000 },
    sourceSize: { width: 1920, height: 1080 },
    preferHardware: true,
    captions: [],
    speeds: [],
    ...extra,
  };
}

async function fakeVideo(args: VideoRouteArgs) {
  await args.sink.begin({
    container: args.config.container,
    codec: args.config.codec,
    width: args.config.width,
    height: args.config.height,
    fps: args.config.fps,
    encoder: args.preferHardware ? "hardware" : "software",
  });
  args.onProgress(progressAt(0.5, { encoder: args.preferHardware ? "hardware" : "software" }));
  await args.sink.writeChunk(new Uint8Array(1000));
  const { path } = await args.sink.finish();
  return {
    path,
    encoder: args.preferHardware ? ("hardware" as const) : ("software" as const),
    attempts: 1,
    pcmWav: null,
  };
}

function setup(overrides: Partial<ExportRunnerDeps> = {}, finishPath = "/exports/Demo.mp4") {
  const phases: ExportFlowPhase[] = [];
  const sinks: FakeFlowSink[] = [];
  const files: { name: string; container: string; text: string }[] = [];
  const system = fakeSystemPort();
  const deps: ExportRunnerDeps = {
    runVideo: vi.fn(fakeVideo),
    runGif: vi.fn(async (args: GifRouteArgs) => {
      await args.sink.begin({ container: "gif" });
      args.onProgress(progressAt(0.3, { encoder: "software" }), 123_456);
      await args.sink.writeChunk(new Uint8Array(10));
      const { path } = await args.sink.finish();
      return { path, bytes: 4242, frames: 30 };
    }),
    createSink: (target) => {
      // A "(n)" path simulates main renaming on collision.
      const s = new FakeFlowSink(
        finishPath.includes("(") ? finishPath : `/exports/${target.finalName}`,
      );
      sinks.push(s);
      return s;
    },
    writeFile: vi.fn(async (target, container, bytes) => {
      files.push({ name: target.finalName, container, text: new TextDecoder().decode(bytes) });
      return `/exports/${target.finalName}`;
    }),
    system,
    onChange: (p) => phases.push(p),
    now: () => 1_700_000_000_000,
    environment: () => ({ os: "test" }),
    ...overrides,
  };
  const runner = createExportRunner(deps);
  return { runner, deps, phases, sinks, files, system };
}

describe("export runner — video", () => {
  it("runs configuring → running → done with size, reveal and copy", async () => {
    const t = setup();
    expect(t.runner.phase()).toEqual({ kind: "configuring" });
    const end = await t.runner.start(request({ revealAfter: true, copyAfter: true }));
    expect(t.phases.map((p) => p.kind)).toEqual(["running", "running", "done"]);
    const running = t.phases[1];
    expect(running).toMatchObject({ kind: "running", fileName: "Demo.mp4", cancelling: false });
    expect(end).toMatchObject({
      kind: "done",
      path: "/exports/Demo.mp4",
      fileName: "Demo.mp4",
      bytes: 1000,
      encoder: "hardware",
      sidecars: [],
      notice: null,
    });
    expect(t.system.calls).toEqual([
      ["reveal", "/exports/Demo.mp4"],
      ["clipboardWriteFile", "/exports/Demo.mp4"],
    ]);
    const args = vi.mocked(t.deps.runVideo).mock.calls[0]?.[0];
    expect(args?.config).toEqual({
      codec: "h264",
      container: "mp4",
      width: 1920,
      height: 1080,
      fps: 60,
      quality: "High",
    });
    expect(args?.includeAudio).toBe(true);
  });

  it("mute skips audio and burn-in is forwarded", async () => {
    const t = setup();
    await t.runner.start(
      request({ audio: "mute", captions: "burn-in" }, { captions: [cap("a", 0, 1)] }),
    );
    const args = vi.mocked(t.deps.runVideo).mock.calls[0]?.[0];
    expect(args?.includeAudio).toBe(false);
    expect(args?.burnInCaptions).toBe(true);
    expect(t.files).toEqual([]);
  });

  it("writes an SRT sidecar named after the final output, re-timed to the range", async () => {
    const t = setup({}, "/exports/Demo (1).mp4");
    const end = await t.runner.start(
      request(
        { captions: "srt" },
        {
          range: { startMs: 1000, endMs: 10_000 },
          captions: [cap("before", 0, 900), cap("hello", 3000, 4000, "Hello")],
        },
      ),
    );
    expect(t.files).toHaveLength(1);
    expect(t.files[0]?.name).toBe("Demo (1).srt");
    expect(t.files[0]?.text).toContain("00:00:02,000 --> 00:00:03,000");
    expect(t.files[0]?.text).toContain("Hello");
    expect(t.files[0]?.text).not.toContain("before");
    expect(end).toMatchObject({ kind: "done", sidecars: ["/exports/Demo (1).srt"] });
  });

  it("a sidecar write failure still finishes the export with a notice", async () => {
    const t = setup({ writeFile: vi.fn(async () => Promise.reject(new Error("EACCES"))) });
    const end = await t.runner.start(
      request({ captions: "vtt" }, { captions: [cap("a", 0, 500)] }),
    );
    expect(end).toMatchObject({ kind: "done" });
    expect(end.kind === "done" && end.notice).toMatch(/Captions file could not be written/);
  });

  it("flags the PCM WAV fallback and writes the audio next to the video", async () => {
    const t = setup({
      runVideo: vi.fn(async (args: VideoRouteArgs) => ({
        ...(await fakeVideo(args)),
        pcmWav: new Uint8Array([82, 73, 70, 70]),
      })),
    });
    const end = await t.runner.start(request());
    expect(t.files[0]).toMatchObject({ name: "Demo.wav", container: "wav", text: "RIFF" });
    expect(end.kind === "done" && end.notice).toMatch(/WAV/);
  });

  it("cancel aborts the route, cancels the sink and returns to cancelled", async () => {
    const started = deferred();
    const t = setup({
      runVideo: vi.fn(async (args: VideoRouteArgs) => {
        await args.sink.begin({
          container: "mp4",
          codec: "h264",
          width: 2,
          height: 2,
          fps: 30,
          encoder: "hardware",
        });
        started.resolve();
        await new Promise((_, reject) =>
          args.signal.addEventListener("abort", () => reject(new ExportCancelledError())),
        );
        throw new Error("unreachable");
      }),
    });
    const run = t.runner.start(request());
    await started.promise;
    t.runner.cancel();
    expect(t.runner.phase()).toMatchObject({ kind: "running", cancelling: true });
    await expect(run).resolves.toEqual({ kind: "cancelled" });
    expect(t.sinks[0]?.events.filter((e) => e === "cancel").length).toBeGreaterThanOrEqual(1);
    expect(t.system.calls).toEqual([]);
    // Cancel after the fact is a no-op.
    t.runner.cancel();
    expect(t.runner.phase()).toEqual({ kind: "cancelled" });
  });

  it("a hardware failure offers software retry, which re-runs with preferHardware=false", async () => {
    let calls = 0;
    const t = setup({
      runVideo: vi.fn(async (args: VideoRouteArgs) => {
        calls++;
        if (calls === 1) throw new EncoderFailure("software", new Error("encoder crashed"));
        return fakeVideo(args);
      }),
    });
    const failed = await t.runner.start(request());
    expect(failed).toMatchObject({
      kind: "failed",
      code: "ENCODER_FAILED",
      canRetrySoftware: true,
    });
    expect(t.sinks[0]?.events).toContain("cancel");
    const done = await t.runner.retrySoftware();
    expect(vi.mocked(t.deps.runVideo).mock.calls[1]?.[0].preferHardware).toBe(false);
    expect(done).toMatchObject({
      kind: "done",
      encoder: "software",
      notice: "Using the software encoder",
    });
    expect(t.sinks).toHaveLength(2);
  });

  it("maps ENOSPC to low-disk and unsupported encoders to codec-unsupported", async () => {
    const disk = setup({
      runVideo: vi.fn(async () => {
        throw Object.assign(new Error("Writing the export failed"), {
          code: "EXPORT_WRITE_FAILED",
          details: { errno: "ENOSPC" },
        });
      }),
    });
    expect(await disk.runner.start(request())).toMatchObject({ kind: "low-disk" });
    const codec = setup({
      runVideo: vi.fn(async () => {
        throw new EncoderUnsupportedError("no encoder");
      }),
    });
    expect(await codec.runner.start(request({ codec: "av1" }))).toMatchObject({
      kind: "codec-unsupported",
      codec: "av1",
    });
  });

  it("copies diagnostics with config, error code and environment", async () => {
    const t = setup({
      runVideo: vi.fn(async () => {
        throw Object.assign(new Error("nope"), { code: "EXPORT_CLOSED", details: { x: 1 } });
      }),
    });
    await t.runner.start(request());
    await t.runner.copyDiagnostics();
    const text = t.system.calls[0]?.[1] as string;
    const parsed = JSON.parse(text);
    expect(parsed.error).toMatchObject({
      code: "EXPORT_CLOSED",
      message: "nope",
      details: { x: 1 },
    });
    expect(parsed.request.config.codec).toBe("h264");
    expect(parsed.environment).toEqual({ os: "test" });
  });

  it("refuses to start twice and ignores reset while running", async () => {
    const gate = deferred();
    const t = setup({
      runVideo: vi.fn(async (args: VideoRouteArgs) => {
        await gate.promise;
        return fakeVideo(args);
      }),
    });
    const run = t.runner.start(request());
    await expect(t.runner.start(request())).rejects.toThrow(/already running/);
    t.runner.reset();
    expect(t.runner.phase().kind).toBe("running");
    gate.resolve();
    await run;
    t.runner.reset();
    expect(t.runner.phase()).toEqual({ kind: "configuring" });
    await expect(createExportRunner(t.deps).retrySoftware()).rejects.toThrow(/nothing to retry/);
  });
});

describe("export runner — GIF", () => {
  it("sizes from the preset + source aspect and forwards the live estimate", async () => {
    const t = setup();
    const end = await t.runner.start(
      request(
        {
          format: "gif",
          gif: { sizePreset: 480, fps: 10, loop: false, dither: "none", colors: 64 },
        },
        { sourceSize: { width: 1000, height: 500 } },
      ),
    );
    const args = vi.mocked(t.deps.runGif).mock.calls[0]?.[0];
    expect(args?.options).toEqual({
      width: 960,
      height: 480,
      fps: 10,
      colors: 64,
      dither: "none",
      loop: false,
    });
    expect(t.phases[1]).toMatchObject({
      kind: "running",
      estimatedBytes: 123_456,
      fileName: "Demo.gif",
    });
    expect(end).toMatchObject({ kind: "done", bytes: 4242, encoder: null });
    expect(t.deps.runVideo).not.toHaveBeenCalled();
  });

  it("GIF failures do not offer a software retry", async () => {
    const t = setup({
      runGif: vi.fn(async () => {
        throw new Error("worker crashed");
      }),
    });
    expect(await t.runner.start(request({ format: "gif" }))).toMatchObject({
      kind: "failed",
      canRetrySoftware: false,
    });
  });
});

describe("helpers", () => {
  it("captionsForOutput clips to the range and applies speed regions", () => {
    const out = captionsForOutput(
      [cap("a", 500, 1500), cap("b", 3000, 4000), cap("c", 20_000, 21_000)],
      { startMs: 1000, endMs: 10_000 },
      [{ startMs: 0, endMs: 2000, rate: 2 }],
    );
    expect(out.map((c) => [c.id, c.startMs, c.endMs])).toEqual([
      ["a", 0, 250],
      ["b", 1500, 2500],
    ]);
  });

  it("isLowDisk recognises codes and errno details", () => {
    expect(isLowDisk({ code: "ENOSPC" })).toBe(true);
    expect(isLowDisk({ code: "X", details: { errno: "EDQUOT" } })).toBe(true);
    expect(isLowDisk(new Error("x"))).toBe(false);
    expect(isLowDisk(null)).toBe(false);
  });

  it("progress patches drive the ring value", () => {
    const base = initialExportProgress();
    const running = {
      ...base,
      ...progressPatchFor({
        kind: "running",
        fileName: "Demo.mp4",
        progress: progressAt(0.43),
        estimatedBytes: null,
        notice: null,
        cancelling: false,
      }),
    };
    expect(progressRingValue(running)).toBe(0.43);
    const done = {
      ...running,
      ...progressPatchFor({
        kind: "done",
        fileName: "Demo.mp4",
        path: "/x/Demo.mp4",
        bytes: 24_000_000,
        sidecars: [],
        encoder: "hardware",
        notice: null,
      }),
    };
    expect(done.label).toBe("Exported · Demo.mp4 (24 MB)");
    expect(progressRingValue(done)).toBeNull();
    expect(progressPatchFor({ kind: "low-disk", message: "m", diagnostics: "" })).toMatchObject({
      activity: "failed",
      error: "m",
    });
    expect(progressPatchFor({ kind: "cancelled" }).activity).toBe("cancelled");
    expect(progressRingValue({ activity: "running", fraction: Number.NaN })).toBe(0);
  });
});

describe("export runner — non-fatal warnings (webcam)", () => {
  const WARN = "Webcam footage couldn't be read — exported without the webcam bubble";

  it("a route warning shows while running and on done, once, after the request notice", async () => {
    const t = setup({
      runVideo: vi.fn(async (args: VideoRouteArgs) => {
        args.onWarning?.(WARN);
        args.onWarning?.(WARN);
        return fakeVideo(args);
      }),
    });
    const end = await t.runner.start(request({}, { notice: "Using the software encoder" }));
    expect(t.phases.some((p) => p.kind === "running" && p.notice?.includes(WARN))).toBe(true);
    expect(end).toMatchObject({ kind: "done", notice: `Using the software encoder · ${WARN}` });
  });

  it("GIF exports surface the warning on done", async () => {
    const t = setup({
      runGif: vi.fn(async (args: GifRouteArgs) => {
        await args.sink.begin({ container: "gif" });
        args.onWarning?.(WARN);
        const { path } = await args.sink.finish();
        return { path, bytes: 10, frames: 1 };
      }),
    });
    const end = await t.runner.start(request({ format: "gif" }));
    expect(end).toMatchObject({ kind: "done", notice: WARN });
  });

  it("a failure after the warning keeps it on the failed phase; a clean retry drops it", async () => {
    let calls = 0;
    const t = setup({
      runVideo: vi.fn(async (args: VideoRouteArgs) => {
        calls++;
        if (calls === 1) {
          args.onWarning?.(WARN);
          throw new Error("muxer exploded");
        }
        return fakeVideo(args);
      }),
    });
    const failed = await t.runner.start(request());
    expect(failed).toMatchObject({ kind: "failed", message: "muxer exploded", notice: WARN });
    const done = await t.runner.retrySoftware();
    expect(done).toMatchObject({ kind: "done", notice: "Using the software encoder" });
  });
});
