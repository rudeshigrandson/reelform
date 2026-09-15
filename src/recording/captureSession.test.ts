import {
  type CaptureDeps,
  type CaptureOptions,
  NO_CAPTURE_TRACKS,
  SYSTEM_AUDIO_UNAVAILABLE,
  startCapture,
} from "./captureSession";
import { UNSUPPORTED_SYSTEM_AUDIO_MAC } from "./constraints";
import { MBPS } from "./encoding";
import {
  FakeAudioContext,
  FakePort,
  ManualScheduler,
  drain,
  fakeBlob,
  fakeMediaEnv,
} from "./testFakes";

function setup(overrides: Partial<CaptureDeps> = {}) {
  const env = fakeMediaEnv();
  const port = new FakePort();
  let clock = 0;
  const deps: CaptureDeps = {
    getUserMedia: env.getUserMedia,
    createRecorder: env.createRecorder,
    createStream: env.createStream,
    isTypeSupported: () => true,
    port,
    now: () => clock,
    timeOrigin: 1_700_000_000_000,
    ...overrides,
  };
  return {
    env,
    port,
    deps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const baseOpts: CaptureOptions = {
  sessionId: "sess",
  platform: "linux",
  desktop: { sourceId: "screen:0:0", size: { width: 1920, height: 1080 }, scaleFactor: 1 },
  fps: 60,
  systemAudio: false,
};

describe("startCapture", () => {
  it("records desktop video with negotiated mime, bitrate and 250ms timeslice", async () => {
    const { env, deps } = setup();
    const s = await startCapture(deps, baseOpts);
    expect(s.tracks).toEqual(["screen"]);
    expect(env.recorders).toHaveLength(1);
    const rec = env.recorders[0];
    expect(rec?.options).toEqual({
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 30_600_000,
    });
    expect(rec?.timeslice).toBe(250);
    expect(rec?.state).toBe("recording");
    expect(env.requests[0]?.video).toMatchObject({
      mandatory: { chromeMediaSourceId: "screen:0:0", maxFrameRate: 60, maxWidth: 1920 },
    });
  });

  it("uses 4K bitrate from scaled pixel size", async () => {
    const { env, deps } = setup();
    await startCapture(deps, {
      ...baseOpts,
      fps: 30,
      desktop: { sourceId: "screen:1:0", size: { width: 1920, height: 1080 }, scaleFactor: 2 },
    });
    expect(env.recorders[0]?.options.videoBitsPerSecond).toBe(45 * MBPS);
  });

  it("starts mic, system and webcam recorders with their own settings", async () => {
    const { env, deps } = setup();
    const s = await startCapture(deps, {
      ...baseOpts,
      platform: "win32",
      systemAudio: true,
      mic: { deviceId: "m1" },
      webcam: { deviceId: "c1", quality: "1080p" },
    });
    expect(s.tracks).toEqual(["screen", "system", "mic", "webcam"]);
    expect(s.warnings).toEqual([]);
    const opts = env.recorders.map((r) => r.options);
    expect(opts[1]).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192_000 });
    expect(opts[2]).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128_000 });
    expect(opts[3]).toEqual({ mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8 * MBPS });
    // Loopback comes from a single combined desktop request, split by kind.
    expect(env.requests).toHaveLength(3);
    expect(env.recorders[0]?.stream.getAudioTracks()).toHaveLength(0);
    expect(env.recorders[1]?.stream.getVideoTracks()).toHaveLength(0);
    expect(env.recorders.every((r) => r.timeslice === 250)).toBe(true);
  });

  it("macOS: system audio yields an explicit warning and video-only capture", async () => {
    const { env, deps } = setup();
    const s = await startCapture(deps, { ...baseOpts, platform: "darwin", systemAudio: true });
    expect(s.warnings).toEqual([UNSUPPORTED_SYSTEM_AUDIO_MAC]);
    expect(s.tracks).toEqual(["screen"]);
    expect(env.requests[0]?.audio).toBe(false);
  });

  it("linux without loopback support falls back to video-only with a warning", async () => {
    const { env, deps } = setup();
    env.failWhen = (c) => c.audio !== false && c.video !== false;
    const s = await startCapture(deps, { ...baseOpts, systemAudio: true });
    expect(s.warnings).toEqual([SYSTEM_AUDIO_UNAVAILABLE]);
    expect(s.tracks).toEqual(["screen"]);
  });

  it("rejects with a stable error and releases acquired streams when a device is denied", async () => {
    const { env, deps } = setup();
    env.failWhen = (c) => c.video === false; // mic request
    await expect(startCapture(deps, { ...baseOpts, mic: {} })).rejects.toEqual({
      code: "NotAllowedError",
      message: "Permission denied",
    });
    expect(env.streams[0]?.tracks.every((t) => t.stopped)).toBe(true);
    expect(env.recorders).toHaveLength(0);
  });

  it("rejects when no video mime is supported", async () => {
    const { deps, env } = setup({ isTypeSupported: () => false });
    await expect(startCapture(deps, baseOpts)).rejects.toMatchObject({ code: "no-supported-mime" });
    expect(env.requests).toHaveLength(0);
  });

  it("streams chunks per track, records first-data timestamp, and ends tracks on stop", async () => {
    const { env, port, deps, advance } = setup();
    advance(500);
    const s = await startCapture(deps, { ...baseOpts, mic: {} });
    const [video, mic] = env.recorders;
    expect(s.timing().recorderStartEpochMs).toBe(1_700_000_000_500);
    advance(10);
    video?.emit(fakeBlob([])); // empty: not the first frame
    advance(20);
    mic?.emit(fakeBlob([9]));
    expect(s.timing().firstDataEpochMs).toBeNull();
    advance(5);
    video?.emit(fakeBlob([1, 2]));
    video?.emit(fakeBlob([3]));
    expect(s.timing().firstDataEpochMs).toBe(1_700_000_000_535);

    if (video) video.autoStop = false;
    const stopping = s.stop();
    expect(s.state).toBe("stopping");
    video?.finishStop(fakeBlob([4]));
    const result = await stopping;

    const videoWrites = port.writes.filter((w) => w.track === "screen");
    expect(videoWrites.map((w) => w.seq)).toEqual([0, 1, 2]);
    expect(port.writes.filter((w) => w.track === "mic")).toHaveLength(1);
    expect(port.ended).toEqual([
      { sessionId: "sess", track: "screen", chunkCount: 3, mimeType: "video/webm;codecs=vp9" },
      { sessionId: "sess", track: "mic", chunkCount: 1, mimeType: "audio/webm;codecs=opus" },
    ]);
    expect(result.tracks.map((t) => t.chunkCount)).toEqual([3, 1]);
    expect(result.errors).toEqual([]);
    expect(s.state).toBe("stopped");
    expect(env.streams.every((st) => st.tracks.every((t) => t.stopped))).toBe(true);
    await expect(s.stop()).rejects.toMatchObject({ code: "capture-not-active" });
  });

  it("sends alignment timing with screen chunk 0 only (§5.6)", async () => {
    const { env, port, deps, advance } = setup();
    const s = await startCapture(deps, { ...baseOpts, mic: {} });
    advance(300);
    env.recorders[1]?.emit(fakeBlob([7])); // mic first: never carries timing
    env.recorders[0]?.emit(fakeBlob([1]));
    advance(10);
    env.recorders[0]?.emit(fakeBlob([2]));
    await s.stop();
    const screen = port.writes.filter((w) => w.track === "screen");
    expect(screen[0]?.timing).toEqual({
      timeOriginMs: 1_700_000_000_000,
      recorderStartMs: 0,
      firstDataMs: 300,
      timesliceMs: 250,
    });
    expect(screen[1]?.timing).toBeUndefined();
    expect(port.writes.find((w) => w.track === "mic")?.timing).toBeUndefined();
  });

  it("pause/resume toggles every recorder and records paused ranges", async () => {
    const { env, deps, advance } = setup();
    const s = await startCapture(deps, { ...baseOpts, mic: {} });
    advance(1000);
    s.pause();
    s.pause(); // idempotent
    expect(env.recorders.every((r) => r.state === "paused")).toBe(true);
    advance(400);
    s.resume();
    expect(env.recorders.every((r) => r.state === "recording")).toBe(true);
    advance(100);
    s.pause();
    advance(50);
    const r = await s.stop(); // stop while paused closes the range
    expect(r.timing.pausedRanges).toEqual([
      { startEpochMs: 1_700_000_001_000, endEpochMs: 1_700_000_001_400 },
      { startEpochMs: 1_700_000_001_500, endEpochMs: 1_700_000_001_550 },
    ]);
  });

  it("discard drops pending data, stops devices and never ends tracks", async () => {
    const { env, port, deps } = setup();
    const s = await startCapture(deps, baseOpts);
    env.recorders[0]?.emit(fakeBlob([1]));
    await s.discard();
    env.recorders[0]?.emit(fakeBlob([2]));
    await drain();
    expect(port.ended).toEqual([]);
    expect(port.writes.length).toBeLessThanOrEqual(1);
    expect(s.state).toBe("discarded");
    expect(env.streams[0]?.tracks.every((t) => t.stopped)).toBe(true);
    await s.discard();
  });

  it("reports write failures through onError and in the stop result", async () => {
    const onError = vi.fn();
    const { env, port, deps } = setup({ onError });
    port.writeImpl = async (r) => {
      if (r.seq === 1) throw { code: "disk-full", message: "ENOSPC" };
    };
    const s = await startCapture(deps, baseOpts);
    env.recorders[0]?.emit(fakeBlob([1]));
    env.recorders[0]?.emit(fakeBlob([2]));
    env.recorders[0]?.emit(fakeBlob([3]));
    const r = await s.stop();
    expect(onError).toHaveBeenCalledWith({ code: "disk-full", message: "ENOSPC" }, "screen");
    expect(r.errors).toEqual([
      { track: "screen", error: { code: "disk-full", message: "ENOSPC" } },
    ]);
    expect(r.tracks[0]?.chunkCount).toBe(1);
    // The track is still ended so main closes the file and keeps chunk 0.
    expect(port.ended).toEqual([
      { sessionId: "sess", track: "screen", chunkCount: 1, mimeType: "video/webm;codecs=vp9" },
    ]);
    expect(port.writes.map((w) => w.seq)).toEqual([0]);
  });

  it("device loss while recording notifies once per ended track, not after stop", async () => {
    const onDeviceLost = vi.fn();
    const { env, deps } = setup({ onDeviceLost });
    const s = await startCapture(deps, { ...baseOpts, mic: {} });
    env.streams[1]?.tracks[0]?.end();
    expect(onDeviceLost).toHaveBeenCalledWith("mic");
    await s.stop();
    env.streams[0]?.tracks[0]?.end();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("releases every acquired stream when a recorder cannot be created", async () => {
    const { env, deps } = setup();
    let n = 0;
    deps.createRecorder = (s, o, e) => {
      if (n++ === 1) throw { name: "NotSupportedError", message: "bad mime" };
      return env.createRecorder(s, o, e);
    };
    await expect(startCapture(deps, { ...baseOpts, mic: {} })).rejects.toEqual({
      code: "NotSupportedError",
      message: "bad mime",
    });
    expect(env.streams).toHaveLength(2);
    expect(env.streams.every((st) => st.tracks.every((t) => t.stopped))).toBe(true);
    expect(env.recorders.every((r) => r.state === "inactive")).toBe(true);
  });

  it("releases streams when MediaRecorder.start throws", async () => {
    const { env, deps } = setup();
    deps.createRecorder = (s, o, e) => {
      const r = env.createRecorder(s, o, e);
      r.start = () => {
        throw new Error("start failed");
      };
      return r;
    };
    await expect(startCapture(deps, baseOpts)).rejects.toMatchObject({ message: "start failed" });
    expect(env.streams[0]?.tracks.every((t) => t.stopped)).toBe(true);
  });

  it("a failing audio context does not abort recording", async () => {
    const sched = new ManualScheduler();
    const { deps } = setup({
      createAudioContext: () => {
        throw new Error("no audio");
      },
      scheduleFrame: sched.schedule,
      onMicLevel: () => {},
    });
    const s = await startCapture(deps, { ...baseOpts, mic: {} });
    expect(s.state).toBe("recording");
    expect(s.tracks).toEqual(["screen", "mic"]);
  });

  it("loopback request carries the desktop source id for audio and video", async () => {
    const { env, deps } = setup();
    await startCapture(deps, { ...baseOpts, systemAudio: true });
    expect(env.requests).toHaveLength(1);
    expect(env.requests[0]?.audio).toEqual({
      mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: "screen:0:0" },
    });
  });

  it("stop result timing is a snapshot independent of later mutation", async () => {
    const { deps } = setup();
    const s = await startCapture(deps, baseOpts);
    s.pause();
    const r = await s.stop();
    r.timing.pausedRanges.push({ startEpochMs: 1, endEpochMs: 2 });
    expect(s.timing().pausedRanges).toHaveLength(1);
  });

  it("drives the mic meter when an audio context factory is injected", async () => {
    const ctx = new FakeAudioContext();
    const sched = new ManualScheduler();
    const levels: number[] = [];
    const { deps } = setup({
      createAudioContext: () => ctx,
      scheduleFrame: sched.schedule,
      onMicLevel: (l) => levels.push(l),
    });
    const s = await startCapture(deps, { ...baseOpts, mic: {} });
    ctx.analyser.value = 0.5;
    sched.run(2);
    expect(levels.length).toBe(2);
    expect(levels[1]).toBeGreaterThan(levels[0] ?? 0);
    await s.stop();
    expect(ctx.closed).toBe(true);
  });
});

describe("device-only capture (webcam beside a native helper)", () => {
  const webcamOnly: CaptureOptions = {
    sessionId: "sess",
    platform: "darwin",
    fps: 60,
    systemAudio: true,
    webcam: { deviceId: "cam-1" },
  };

  it("records only the webcam, ignores system audio and sends its timing with chunk 0", async () => {
    const { env, deps, port, advance } = setup();
    advance(100);
    const s = await startCapture(deps, webcamOnly);
    expect(s.tracks).toEqual(["webcam"]);
    expect(env.requests).toHaveLength(1);
    expect(env.requests[0]?.audio).toBe(false);
    expect(env.requests[0]?.video).toMatchObject({ deviceId: { exact: "cam-1" } });
    advance(250);
    env.recorders[0]?.emit(fakeBlob(4));
    env.recorders[0]?.emit(fakeBlob(2));
    await drain(20);
    expect(port.writes.map((w) => [w.track, w.seq])).toEqual([
      ["webcam", 0],
      ["webcam", 1],
    ]);
    expect(port.writes[0]?.timing).toEqual({
      timeOriginMs: 1_700_000_000_000,
      recorderStartMs: 100,
      firstDataMs: 350,
      timesliceMs: 250,
    });
    expect(port.writes[1]?.timing).toBeUndefined();
    expect(s.timing().firstDataEpochMs).toBe(1_700_000_000_350);
    const stopped = await s.stop();
    expect(stopped.tracks).toEqual([
      { track: "webcam", mimeType: "video/webm;codecs=vp9", chunkCount: 2 },
    ]);
    expect(port.ended).toEqual([
      { sessionId: "sess", track: "webcam", chunkCount: 2, mimeType: "video/webm;codecs=vp9" },
    ]);
  });

  it("refuses a capture with nothing to record", async () => {
    const { deps } = setup();
    await expect(
      startCapture(deps, { sessionId: "s", platform: "linux", fps: 30, systemAudio: true }),
    ).rejects.toMatchObject({ code: NO_CAPTURE_TRACKS });
  });
});

describe("setMicMuted", () => {
  it("disables and re-enables only the mic tracks while recording", async () => {
    const { env, deps } = setup();
    const s = await startCapture(deps, { ...baseOpts, mic: { deviceId: "m1" } });
    const [desktop, mic] = env.streams;
    s.setMicMuted?.(true);
    expect(mic?.tracks.every((t) => t.enabled === false)).toBe(true);
    expect(desktop?.tracks.every((t) => t.enabled)).toBe(true);
    s.pause();
    s.setMicMuted?.(false);
    expect(mic?.tracks.every((t) => t.enabled)).toBe(true);
    await s.stop();
    s.setMicMuted?.(true);
    expect(mic?.tracks.every((t) => t.enabled)).toBe(true);
  });

  it("is a no-op without a mic", async () => {
    const { env, deps } = setup();
    const s = await startCapture(deps, baseOpts);
    s.setMicMuted?.(true);
    expect(env.streams[0]?.tracks.every((t) => t.enabled)).toBe(true);
  });
});
