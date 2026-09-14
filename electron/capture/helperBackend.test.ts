import { describe, expect, it } from "vitest";
import { STOP_TIMEOUT_MS, expectedNativePaths, mapHelperEvent, parsePtsNs } from "./helperBackend";
import { HelperProcess } from "./helperProcess";
import { type NativeBackendDeps, createSckBackend } from "./sckBackend";
import { type FakeChild, type HelperScript, fakeHelperEnv, flush, scriptHelper } from "./testUtils";
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
