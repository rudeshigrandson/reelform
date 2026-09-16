import { describe, expect, it } from "vitest";
import {
  MIC_MUTE_CAP,
  STOP_TIMEOUT_MS,
  expectedNativePaths,
  helperStartMessage,
  mapHelperEvent,
  parsePtsNs,
} from "./helperBackend";
import { HelperProcess } from "./helperProcess";
import { type NativeBackendDeps, createSckBackend } from "./sckBackend";
import {
  type FakeChild,
  FakeTimers,
  type HelperScript,
  fakeHelperEnv,
  flush,
  scriptHelper,
} from "./testUtils";
import type { CaptureEvent, StartOptions } from "./types";
import { createWgcBackend } from "./wgcBackend";

const join = (...p: string[]) => p.join("/");

const opts: StartOptions = {
  sessionId: "s1",
  outDir: "/rec/s1",
  source: { kind: "display", id: "1" },
  audio: { system: true, mic: "mic-1" },
  fps: 60,
  countdown: 3,
  hideCursor: true,
};

function setup(script: HelperScript = {}, over: Partial<NativeBackendDeps> = {}) {
  const env = fakeHelperEnv((c) => scriptHelper(c, script));
  let created = 0;
  const deps: NativeBackendDeps = {
    currentPlatform: "darwin",
    verify: async () => ({ ok: true, path: "/bin/reelform-sck" }),
    createHelper: (path) => {
      created++;
      return new HelperProcess({ command: path, watchdogMs: 5000 }, env.deps);
    },
    join,
    ...over,
  };
  const events: CaptureEvent[] = [];
  return {
    env,
    backend: createSckBackend(deps),
    events,
    sink: (e: CaptureEvent) => events.push(e),
    created: () => created,
  };
}

describe("parsePtsNs / mapHelperEvent", () => {
  it("parses numbers and decimal strings beyond 2^53 exactly", () => {
    expect(parsePtsNs(42)).toBe(42n);
    expect(parsePtsNs("9007199254740993123")).toBe(9007199254740993123n);
    expect(parsePtsNs(1.5)).toBeNull();
    expect(parsePtsNs("12a")).toBeNull();
    expect(parsePtsNs(undefined)).toBeNull();
  });

  it("maps protocol messages to sink events", () => {
    expect(mapHelperEvent({ t: "stats", fps: 59.9, droppedFrames: 2, fileBytes: 10 })).toEqual({
      type: "stats",
      fps: 59.9,
      droppedFrames: 2,
      fileBytes: 10,
      micRms: undefined,
    });
    expect(mapHelperEvent({ t: "interrupted", reason: "displayDisconnected" })).toEqual({
      type: "interrupted",
      reason: "displayDisconnected",
      detail: undefined,
    });
    expect(mapHelperEvent({ t: "interrupted", reason: "gpuReset" })).toEqual({
      type: "interrupted",
      reason: "other",
      detail: "gpuReset",
    });
    expect(mapHelperEvent({ t: "started", firstFramePtsNs: "bad" })).toBeNull();
    expect(mapHelperEvent({ t: "deviceLost" })).toEqual({ type: "deviceLost", device: "unknown" });
    expect(mapHelperEvent({ t: "whatever" })).toBeNull();
  });

  it("expected paths follow the requested tracks", () => {
    expect(expectedNativePaths({ ...opts, audio: { system: false } }, join)).toEqual({
      screen: "/rec/s1/screen.mp4",
    });
    expect(expectedNativePaths(opts, join)).toEqual({
      screen: "/rec/s1/screen.mp4",
      system: "/rec/s1/system.m4a",
      mic: "/rec/s1/mic.m4a",
    });
  });
});

describe("isAvailable", () => {
  it("requires the target platform", async () => {
    expect(await setup({}, { currentPlatform: "linux" }).backend.isAvailable()).toEqual({
      ok: false,
      reason: "requires macOS",
    });
    const wgc = createWgcBackend({
      currentPlatform: "darwin",
      verify: async () => ({ ok: true, path: "x" }),
      createHelper: () => {
        throw new Error("unused");
      },
      join,
    });
    expect(wgc.id).toBe("wgc");
    expect(await wgc.isAvailable()).toEqual({ ok: false, reason: "requires Windows" });
  });

  it("reports manifest failures as the reason", async () => {
    const { backend } = setup(
      {},
      { verify: async () => ({ ok: false, reason: "reelform-sck checksum mismatch" }) },
    );
    expect(await backend.isAvailable()).toEqual({
      ok: false,
      reason: "reelform-sck checksum mismatch",
    });
  });

  it("pings the helper once, checks caps, and caches", async () => {
    const s = setup();
    expect(await s.backend.isAvailable()).toEqual({ ok: true });
    expect(await s.backend.isAvailable()).toEqual({ ok: true });
    expect(s.created()).toBe(1);
    expect(s.env.killed).toEqual([4242]);
  });

  it("unavailable when the helper lacks the capture capability", async () => {
    const s = setup({ caps: ["cursor"], version: "0.9.0" });
    expect(await s.backend.isAvailable()).toEqual({
      ok: false,
      reason: 'helper 0.9.0 lacks "capture" capability',
    });
  });

  it("does not cache a failed ping", async () => {
    const s = setup({ silentPing: true });
    const p = s.backend.isAvailable();
    await flush();
    s.env.timers.advance(12_000);
    expect((await p).reason).toMatch(/helper ping failed/);
    const retry = s.backend.isAvailable();
    await flush();
    s.env.timers.advance(12_000);
    expect((await retry).ok).toBe(false);
    expect(s.created()).toBe(2);
  });
});

describe("listSources", () => {
  it("requests sources, validates and kills the helper", async () => {
    const display = {
      id: "1",
      name: "Built-in",
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
    };
    const s = setup({ sources: { displays: [display], windows: [] } });
    expect(await s.backend.listSources()).toEqual({ displays: [display], windows: [] });
    expect(s.env.killed).toEqual([4242]);
  });
});

describe("start / session", () => {
  it("sends start, waits for ready, forwards started/stats and arms the watchdog", async () => {
    const s = setup({ firstFramePtsNs: "9007199254740993000" });
    const session = await s.backend.start(opts, s.sink);
    const startMsg = s.env.children[0]?.written.find((m) => m.t === "start");
    expect(startMsg).toMatchObject({
      t: "start",
      outDir: "/rec/s1",
      fps: 60,
      hideCursor: true,
      sessionId: "s1",
    });
    expect(s.events).toEqual([{ type: "started", firstFramePtsNs: 9007199254740993000n }]);
    expect(session.backend).toBe("sck");

    s.env.children[0]?.reply({ t: "stats", fps: 60, droppedFrames: 0, fileBytes: 100 });
    expect(s.events[1]).toMatchObject({ type: "stats", fileBytes: 100 });

    // Watchdog armed: silence → crash → interrupted.
    s.env.timers.advance(5000);
    expect(s.events[2]).toMatchObject({
      type: "interrupted",
      reason: "helperCrash",
      detail: "watchdog",
    });
  });

  it("pause/resume round-trip through the helper", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    await session.pause();
    await session.resume();
    expect(s.env.children[0]?.written.map((m) => m.t)).toEqual([
      "ping",
      "start",
      "pause",
      "resume",
    ]);
  });

  it("stop returns helper paths, kills the helper, and a later exit is not a crash", async () => {
    const s = setup({ stopPaths: { screen: "/rec/s1/screen.mp4", system: "/rec/s1/system.m4a" } });
    const session = await s.backend.start(opts, s.sink);
    await session.stop();
    const child = s.env.children[0] as FakeChild;
    child.exit(0);
    expect(await session.close()).toEqual({
      durationMs: 1234,
      paths: { screen: "/rec/s1/screen.mp4", system: "/rec/s1/system.m4a", mic: "/rec/s1/mic.m4a" },
    });
    expect(s.env.killed).toEqual([4242]);
    expect(s.events.filter((e) => e.type === "interrupted")).toEqual([]);
    // stop is idempotent
    await session.stop();
    expect(child.written.filter((m) => m.t === "stop")).toHaveLength(1);
  });

  it("a helper silently finalizing writers for longer than the watchdog is not killed on stop", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    const child = s.env.children[0] as FakeChild;
    const base = child.onWrite;
    let stopId: number | undefined;
    child.onWrite = (m, c) => {
      if (m.t === "stop") {
        stopId = m.id;
        return; // answer later, after a long silent moov rewrite
      }
      base?.(m, c);
    };
    const stopping = session.stop();
    await flush();
    s.env.timers.advance(20_000); // 4× the watchdog window
    expect(s.env.killed).toEqual([]);
    child.reply({
      t: "stopped",
      id: stopId,
      durationMs: 99,
      paths: { screen: "/rec/s1/screen.mp4" },
    });
    await stopping;
    expect(s.events.filter((e) => e.type === "interrupted")).toEqual([]);
    expect((await session.close()).durationMs).toBe(99);
    expect(s.env.killed).toEqual([4242]);
  });

  it("a helper that never answers stop is killed after STOP_TIMEOUT_MS and keeps expected files", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    const child = s.env.children[0] as FakeChild;
    const base = child.onWrite;
    child.onWrite = (m, c) => {
      if (m.t !== "stop") base?.(m, c);
    };
    const closing = session.close();
    await flush();
    s.env.timers.advance(STOP_TIMEOUT_MS);
    expect(await closing).toEqual({ durationMs: null, paths: expectedNativePaths(opts, join) });
    expect(s.env.killed).toEqual([4242]);
  });

  it("a crash mid-recording interrupts and close falls back to the expected files", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    s.env.children[0]?.stderr.push("EXC_BAD_ACCESS\n");
    s.env.children[0]?.exit(null, "SIGSEGV");
    expect(s.events.at(-1)).toEqual({
      type: "interrupted",
      reason: "helperCrash",
      detail: "EXC_BAD_ACCESS",
    });
    expect(await session.close()).toEqual({
      durationMs: null,
      paths: expectedNativePaths(opts, join),
    });
  });

  it("an unsolicited stopped (after helper-side interruption) is used by close", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    const child = s.env.children[0] as FakeChild;
    child.reply({ t: "interrupted", reason: "displayDisconnected" });
    child.reply({ t: "stopped", durationMs: 42_000, paths: { screen: "/rec/s1/screen.mp4" } });
    child.exit(0);
    expect(s.events.filter((e) => e.type === "interrupted")).toHaveLength(1);
    expect((await session.close()).durationMs).toBe(42_000);
  });

  it("discard sends discard and kills", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    await session.discard();
    expect(s.env.children[0]?.written.map((m) => m.t)).toContain("discard");
    expect(s.env.killed).toEqual([4242]);
  });

  it("start rejects and kills the helper on an error reply", async () => {
    const s = setup({ failStart: true });
    await expect(s.backend.start(opts, s.sink)).rejects.toMatchObject({ code: "SCK_DENIED" });
    expect(s.env.killed).toEqual([4242]);
    expect(s.events).toEqual([]);
  });

  it("start rejects with the manifest reason", async () => {
    const s = setup(
      {},
      { verify: async () => ({ ok: false, reason: "reelform-sck binary missing" }) },
    );
    await expect(s.backend.start(opts, s.sink)).rejects.toThrow("reelform-sck binary missing");
  });
});

describe("start message (mic label, Windows bounds)", () => {
  it("forwards micLabel / micEndpointId and adds display bounds when resolved", async () => {
    const s = setup(
      {},
      {
        resolveSourceBounds: (src) =>
          src.kind === "display" ? { x: 0, y: 0, width: 3840, height: 2160 } : null,
      },
    );
    await s.backend.start(
      {
        ...opts,
        audio: { system: false, mic: "hashed", micLabel: "Shure MV7", micEndpointId: "{0.0.1}" },
      },
      s.sink,
    );
    const start = s.env.children[0]?.written.find((m) => m.t === "start");
    expect(start?.audio).toEqual({
      system: false,
      mic: "hashed",
      micLabel: "Shure MV7",
      micEndpointId: "{0.0.1}",
    });
    expect(start?.source).toEqual({
      kind: "display",
      id: "1",
      bounds: { x: 0, y: 0, width: 3840, height: 2160 },
    });
  });

  it("window sources and unresolved displays are sent unchanged", () => {
    expect(
      helperStartMessage(
        { ...opts, source: { kind: "window", id: "9" } },
        { x: 0, y: 0, width: 1, height: 1 },
      ).source,
    ).toEqual({ kind: "window", id: "9" });
    const msg = helperStartMessage(opts);
    expect(msg.source).toEqual({ kind: "display", id: "1" });
    expect(msg.audio).toEqual({ system: true, mic: "mic-1" });
  });
});

function webcamSetup(script: HelperScript = {}, graceMs = 1000) {
  const files = new Map<string, number[]>();
  const closed: string[] = [];
  let clock = 1_700_000_000_000;
  const graceTimers = new FakeTimers();
  const s = setup(script, {
    timers: graceTimers,
    openWriter: async (path) => {
      files.set(path, []);
      return {
        write: async (b) => {
          files.get(path)?.push(...b);
        },
        close: async () => {
          closed.push(path);
        },
      };
    },
    nowEpochMs: () => clock,
    endTrackGraceMs: graceMs,
  });
  return {
    ...s,
    files,
    closed,
    graceTimers,
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

describe("renderer webcam track", () => {
  it("writes webcam chunks, ends the track and reports its offset from the helper start", async () => {
    const s = webcamSetup();
    // Helper `started` arrives at epoch 1_700_000_000_000.
    const session = await s.backend.start(opts, s.sink);
    await session.writeChunk?.("webcam", new Uint8Array([1, 2]), 0, {
      timeOriginMs: 1_700_000_000_000,
      recorderStartMs: 120,
    });
    await session.writeChunk?.("webcam", new Uint8Array([3]), 1);
    expect(await session.endTrack?.("webcam", 2)).toEqual({ chunkCount: 2 });
    const res = await session.close();
    expect(s.files.get("/rec/s1/webcam.webm")).toEqual([1, 2, 3]);
    expect(s.closed).toEqual(["/rec/s1/webcam.webm"]);
    expect(res.paths.webcam).toBe("/rec/s1/webcam.webm");
    expect(res.paths.screen).toBe("/rec/s1/screen.mp4");
    expect(res.trackOffsetsMs).toEqual({ webcam: 120 });
  });

  it("refuses non-webcam tracks and keeps the seq contract", async () => {
    const s = webcamSetup();
    const session = await s.backend.start(opts, s.sink);
    await expect(session.writeChunk?.("screen", new Uint8Array([1]), 0)).rejects.toMatchObject({
      code: "WRONG_TRACK",
    });
    await expect(session.writeChunk?.("webcam", new Uint8Array([1]), 1)).rejects.toMatchObject({
      code: "CHUNK_GAP",
    });
    await expect(session.endTrack?.("mic", 0)).rejects.toMatchObject({ code: "WRONG_TRACK" });
  });

  it("without a writer the backend refuses webcam chunks", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    await expect(session.writeChunk?.("webcam", new Uint8Array([1]), 0)).rejects.toMatchObject({
      code: "WRONG_TRACK",
    });
    expect((await session.close()).trackOffsetsMs).toBeUndefined();
  });

  it("close waits for the renderer's final webcam flush after a helper crash, then reports it incomplete past the grace", async () => {
    const s = webcamSetup({}, 1000);
    const session = await s.backend.start(opts, s.sink);
    await session.writeChunk?.("webcam", new Uint8Array([7]), 0);
    s.env.children[0]?.exit(null, "SIGSEGV");
    expect(s.events.at(-1)).toMatchObject({ type: "interrupted", reason: "helperCrash" });
    const closing = session.close();
    await flush();
    // Still accepting the flush while waiting.
    await session.writeChunk?.("webcam", new Uint8Array([8]), 1);
    s.graceTimers.advance(1000);
    const res = await closing;
    expect(s.files.get("/rec/s1/webcam.webm")).toEqual([7, 8]);
    expect(res.incompleteTracks).toEqual(["webcam"]);
    expect(res.paths).toMatchObject({
      screen: "/rec/s1/screen.mp4",
      webcam: "/rec/s1/webcam.webm",
    });
  });

  it("discard closes the webcam file and refuses later chunks", async () => {
    const s = webcamSetup();
    const session = await s.backend.start(opts, s.sink);
    await session.writeChunk?.("webcam", new Uint8Array([1]), 0);
    await session.discard();
    expect(s.closed).toEqual(["/rec/s1/webcam.webm"]);
    await expect(session.writeChunk?.("webcam", new Uint8Array([2]), 1)).rejects.toMatchObject({
      code: "SESSION_CLOSED",
    });
  });
});

describe("setMicMuted", () => {
  it("sends setMicMuted when the helper advertises micMute", async () => {
    const s = setup({ caps: ["capture", MIC_MUTE_CAP] });
    const child = () => s.env.children[0] as FakeChild;
    const session = await s.backend.start(opts, s.sink);
    const base = child().onWrite;
    child().onWrite = (m, c) => {
      if (m.t === "setMicMuted") c.reply({ t: "ok", id: m.id });
      else base?.(m, c);
    };
    expect(await session.setMicMuted?.(true)).toBe(true);
    expect(child().written.find((m) => m.t === "setMicMuted")).toMatchObject({ muted: true });
  });

  it("reports unsupported (false) without sending when the helper lacks the cap", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    expect(await session.setMicMuted?.(true)).toBe(false);
    expect(s.env.children[0]?.written.some((m) => m.t === "setMicMuted")).toBe(false);
  });

  it("is a no-op success when no mic is recorded", async () => {
    const s = setup();
    const session = await s.backend.start({ ...opts, audio: { system: true } }, s.sink);
    expect(await session.setMicMuted?.(true)).toBe(true);
  });
});
