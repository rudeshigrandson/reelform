import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { type TrackWriter, createElectronBackend } from "../capture/electronBackend";
import { FakeTimers, flush } from "../capture/testUtils";
import type {
  BackendId,
  CaptureBackend,
  EventSink,
  Session,
  Sources,
  StartOptions,
  StartRequest,
} from "../capture/types";
import type { RecordingEvent } from "./contracts";
import {
  type RecordingDeps,
  type RecordingSettings,
  createRecordingController,
  resolveCaptureArea,
} from "./controller";
import { INTERRUPT_FREE_BYTES, MIN_FREE_BYTES_TO_START } from "./rules";
import { TelemetryFile } from "./telemetry";
import { FakeHook } from "./testUtils";

const GIB = 1024 ** 3;
const EPOCH_MS = 1_700_000_000_000;

const SOURCES: Sources = {
  displays: [
    {
      id: "d1",
      name: "Built-in",
      bounds: { x: 0, y: 0, width: 1000, height: 500 },
      scaleFactor: 2,
    },
    {
      id: "d2",
      name: "External",
      bounds: { x: 1000, y: 0, width: 2000, height: 1000 },
      scaleFactor: 1,
    },
  ],
  windows: [
    {
      id: "w1",
      title: "Editor",
      bounds: { x: 1100, y: 100, width: 800, height: 600 },
      displayId: "d2",
    },
    { id: "w2", title: "No bounds" },
  ],
};

const REQ: StartRequest = {
  source: { kind: "display", id: "d1" },
  audio: { system: false },
  fps: 60,
  countdown: 0,
  hideCursor: true,
};

/** Scriptable native-like backend (no writeChunk). */
function fakeNative(id: BackendId = "sck") {
  const ctl = {
    sink: null as EventSink | null,
    opts: null as StartOptions | null,
    startError: null as Error | null,
    startGate: null as Promise<void> | null,
    paths: { screen: "/rec/s1/screen.mp4" } as Record<string, string>,
    durationMs: null as number | null,
  };
  const session: Session = {
    backend: id,
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    close: vi.fn(async () => ({ durationMs: ctl.durationMs, paths: { ...ctl.paths } })),
  };
  const backend: CaptureBackend = {
    id,
    isAvailable: async () => ({ ok: true }),
    listSources: async () => SOURCES,
    start: vi.fn(async (opts: StartOptions, sink: EventSink) => {
      if (ctl.startGate) await ctl.startGate;
      if (ctl.startError) throw ctl.startError;
      ctl.opts = opts;
      ctl.sink = sink;
      return session;
    }),
  };
  return { backend, session, ctl };
}

function harness(opts: { backends?: CaptureBackend[]; deps?: Partial<RecordingDeps> } = {}) {
  const timers = new FakeTimers();
  const events: RecordingEvent[] = [];
  const files = new Map<string, Uint8Array>();
  const sizes = new Map<string, number>([["/rec/s1/screen.mp4", 1000]]);
  const removed: string[] = [];
  const made: string[] = [];
  const hook = new FakeHook();
  const env = { free: 10 * GIB, perms: { ok: true } as { ok: boolean; missing?: string[] } };
  const settings: RecordingSettings = { keepTypedText: false };
  const native = fakeNative();
  let ids = 0;
  const deps: RecordingDeps = {
    backends: opts.backends ?? [native.backend],
    platform: "darwin",
    os: "darwin 25",
    appVersion: "1.0.0",
    settings: () => settings,
    checkPermissions: async () => env.perms,
    freeDiskBytes: async () => env.free,
    recordingsDir: "/rec",
    join: (...p) => p.join("/"),
    mkdir: async (p) => {
      made.push(p);
    },
    removeDir: async (p) => {
      removed.push(p);
    },
    writeFile: async (p, b) => {
      files.set(p, b);
    },
    fileSize: async (p) => files.get(p)?.length ?? sizes.get(p) ?? null,
    gzip: async (b) => new Uint8Array(gzipSync(b)),
    newId: () => `s${++ids}`,
    nowMs: () => timers.now,
    nowIso: () => "2026-09-14T00:00:00.000Z",
    hostNowNs: (backend) =>
      backend === "electron"
        ? BigInt(EPOCH_MS + timers.now) * 1_000_000n
        : BigInt(timers.now) * 1_000_000n,
    timers,
    emit: (e) => events.push(e),
    inputHook: hook,
    ...opts.deps,
  };
  const controller = createRecordingController(deps);
  const h = controller.handlers;
  const types = () => events.map((e) => e.type);
  const telemetryOf = (dir = "/rec/s1") => {
    const bytes = files.get(`${dir}/telemetry.json.gz`);
    if (!bytes) throw new Error("no telemetry written");
    return TelemetryFile.parse(JSON.parse(gunzipSync(bytes).toString("utf8")));
  };
  /** Start with countdown 0 and let the backend come up. */
  const startRecording = async (req: StartRequest = REQ) => {
    const res = await h["recording:start"](req);
    await flush();
    return res;
  };
  return {
    timers,
    events,
    files,
    sizes,
    removed,
    made,
    hook,
    env,
    settings,
    native,
    deps,
    controller,
    h,
    types,
    telemetryOf,
    startRecording,
  };
}

describe("resolveCaptureArea", () => {
  it("display, region (display-local) and window areas", () => {
    expect(resolveCaptureArea(SOURCES, { ...REQ, source: { kind: "display", id: "d2" } })).toEqual({
      origin: "display",
      bounds: { x: 1000, y: 0, width: 2000, height: 1000 },
      scaleFactor: 1,
      displayId: "d2",
    });
    expect(
      resolveCaptureArea(SOURCES, {
        ...REQ,
        source: { kind: "display", id: "d2" },
        region: { x: 10, y: 20, width: 300, height: 200 },
      }),
    ).toMatchObject({ origin: "region", bounds: { x: 1010, y: 20, width: 300, height: 200 } });
    expect(
      resolveCaptureArea(SOURCES, { ...REQ, source: { kind: "window", id: "w1" } }),
    ).toMatchObject({
      origin: "window",
      scaleFactor: 1,
      displayId: "d2",
    });
  });

  it("window without bounds falls back to the primary display; missing sources → null", () => {
    expect(
      resolveCaptureArea(SOURCES, { ...REQ, source: { kind: "window", id: "w2" } }),
    ).toMatchObject({
      origin: "display",
      bounds: SOURCES.displays[0]?.bounds,
    });
    expect(
      resolveCaptureArea(SOURCES, { ...REQ, source: { kind: "window", id: "gone" } }),
    ).toBeNull();
    expect(
      resolveCaptureArea(SOURCES, { ...REQ, source: { kind: "display", id: "gone" } }),
    ).toBeNull();
  });
});

describe("recording controller — happy path", () => {
  it("prepare → countdown → record ⇄ pause → stop → finalize → done", async () => {
    const t = harness();
    const res = await t.h["recording:start"]({ ...REQ, countdown: 3 });
    expect(res).toEqual({ sessionId: "s1", backend: "sck", backendReasons: [] });
    expect(t.made).toEqual(["/rec/s1"]);
    expect(t.controller.stateOf("s1")).toBe("countdown");
    expect(t.native.backend.start).not.toHaveBeenCalled();

    await t.timers.advanceAsync(3000);
    expect(
      t.events
        .filter((e) => e.type === "countdown")
        .map((e) => (e.type === "countdown" ? e.remaining : -1)),
    ).toEqual([3, 2, 1]);
    expect(t.controller.stateOf("s1")).toBe("recording");
    expect(t.native.ctl.opts).toMatchObject({ sessionId: "s1", outDir: "/rec/s1", fps: 60 });
    t.native.ctl.sink?.({ type: "started", firstFramePtsNs: 3_010_000_000n });
    t.native.ctl.sink?.({ type: "stats", fps: 60, droppedFrames: 1, fileBytes: 5000 });

    await t.timers.advanceAsync(1000);
    expect(t.events.at(-1)).toEqual({
      sessionId: "s1",
      type: "stats",
      recordedMs: 1000,
      fps: 60,
      droppedFrames: 1,
      fileBytes: 5000,
      micRms: undefined,
    });

    t.hook.emit("mousemove", { x: 500, y: 250 }); // t=4000 → 990ms after first frame
    await t.h["recording:pause"]({ sessionId: "s1" });
    expect(t.controller.stateOf("s1")).toBe("paused");
    await t.timers.advanceAsync(2000);
    expect(t.events.filter((e) => e.type === "stats").at(-1)).toMatchObject({ recordedMs: 1000 });
    await t.h["recording:resume"]({ sessionId: "s1" });
    await t.timers.advanceAsync(500);
    t.hook.emit("mousedown", { x: 1000, y: 500, button: 1 }); // t=6500 → 3490 - 2000 paused = 1490
    await t.h["recording:stop"]({ sessionId: "s1" });
    expect(t.native.session.stop).toHaveBeenCalledOnce();
    expect(t.controller.stateOf("s1")).toBe("finalizing");
    expect(t.events.at(-1)).toEqual({
      sessionId: "s1",
      type: "stopped",
      recordedMs: 1500,
      reason: "user",
    });

    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(t.controller.stateOf("s1")).toBe("done");
    expect(fin.video).toEqual({ path: "/rec/s1/screen.mp4", bytes: 1000 });
    expect(fin.mic).toBeUndefined();
    expect(fin.meta).toMatchObject({
      backend: "sck",
      durationMs: 1500,
      pausedRanges: [{ startMs: 1000, endMs: 3000 }],
      firstFramePtsNs: "3010000000",
      telemetryAligned: true,
      scaleFactor: 2,
      recordedFps: 60,
    });
    expect(fin.meta.interrupted).toBeUndefined();
    const tel = t.telemetryOf();
    expect(tel.points).toEqual([[990, 0.5, 0.5, "arrow"]]);
    expect(tel.clicks).toEqual([[1490, 1, 1, 1, "down"]]);
    expect(fin.telemetry).toEqual({
      path: "/rec/s1/telemetry.json.gz",
      pointCount: 1,
      hasClicks: true,
      hasKeys: false,
      sampleHz: 120,
    });
    expect(JSON.parse(new TextDecoder().decode(t.files.get("/rec/s1/meta.json")))).toEqual(
      fin.meta,
    );
    expect(t.hook.listenerCount).toBe(0);
    expect(t.timers.pendingCount).toBe(0);

    // idempotent; a new session may start
    expect(await t.h["recording:finalize"]({ sessionId: "s1" })).toBe(fin);
    await expect(t.startRecording()).resolves.toMatchObject({ sessionId: "s2" });
  });

  it("prefers the helper-measured duration and runs postProcess", async () => {
    const postProcess = vi.fn(async (r) => ({
      ...r,
      video: { path: "/rec/s1/screen.remuxed.mp4" },
    }));
    const t = harness({ deps: { postProcess } });
    t.native.ctl.durationMs = 4321;
    await t.startRecording();
    await t.h["recording:stop"]({ sessionId: "s1" });
    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(fin.meta.durationMs).toBe(4321);
    expect(fin.video.path).toBe("/rec/s1/screen.remuxed.mp4");
    expect(postProcess).toHaveBeenCalledOnce();
  });
});

describe("recording controller — preparing", () => {
  it("rejects a second concurrent session", async () => {
    const t = harness();
    await t.startRecording();
    await expect(t.h["recording:start"](REQ)).rejects.toMatchObject({ code: "SESSION_ACTIVE" });
  });

  it("permission denied → PERMISSION_DENIED, nothing left behind", async () => {
    const t = harness();
    t.env.perms = { ok: false, missing: ["screen"] };
    await expect(t.h["recording:start"](REQ)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      details: { missing: ["screen"] },
    });
    expect(t.controller.stateOf("s1")).toBeNull();
    expect(t.made).toEqual([]);
    t.env.perms = { ok: true };
    await expect(t.startRecording()).resolves.toMatchObject({ sessionId: "s2" });
  });

  it("requires ≥ 2 GB free (boundary inclusive)", async () => {
    const t = harness();
    t.env.free = MIN_FREE_BYTES_TO_START - 1;
    await expect(t.h["recording:start"](REQ)).rejects.toMatchObject({ code: "DISK_LOW" });
    t.env.free = MIN_FREE_BYTES_TO_START;
    await expect(t.startRecording()).resolves.toMatchObject({ sessionId: "s2" });
  });

  it("unknown source → SOURCE_NOT_FOUND; no backend → BACKEND_UNAVAILABLE with reasons", async () => {
    const t = harness();
    await expect(
      t.h["recording:start"]({ ...REQ, source: { kind: "display", id: "gone" } }),
    ).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND",
    });
    const none = harness({
      backends: [
        {
          ...fakeNative().backend,
          isAvailable: async () => ({ ok: false, reason: "reelform-sck checksum mismatch" }),
        },
      ],
    });
    await expect(none.h["recording:start"](REQ)).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      details: {
        reasons: ["sck: reelform-sck checksum mismatch", "electron: not built for this platform"],
      },
    });
  });

  it("discard while preparing cancels the start", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const t = harness({
      deps: {
        checkPermissions: async () => {
          await gate;
          return { ok: true };
        },
      },
    });
    const p = t.h["recording:start"](REQ);
    await flush();
    await t.h["recording:discard"]({ sessionId: "s1" });
    release();
    await expect(p).rejects.toMatchObject({ code: "DISCARDED" });
    expect(t.controller.stateOf("s1")).toBe("discarded");
    expect(t.native.backend.start).not.toHaveBeenCalled();
  });

  it("discard during countdown never starts the backend and removes the folder", async () => {
    const t = harness();
    await t.h["recording:start"]({ ...REQ, countdown: 5 });
    await t.timers.advanceAsync(2000);
    await t.h["recording:discard"]({ sessionId: "s1" });
    await t.timers.advanceAsync(10_000);
    expect(t.native.backend.start).not.toHaveBeenCalled();
    expect(t.removed).toEqual(["/rec/s1"]);
    expect(t.types().at(-1)).toBe("discarded");
    expect(t.timers.pendingCount).toBe(0);
    // idempotent
    await expect(t.h["recording:discard"]({ sessionId: "s1" })).resolves.toEqual({ ok: true });
  });

  it("backend start failure after countdown → error event, idle, can retry", async () => {
    const t = harness();
    t.native.ctl.startError = Object.assign(new Error("helper did not answer"), {
      code: "HELPER_START_TIMEOUT",
    });
    await t.startRecording();
    expect(t.events.at(-1)).toEqual({
      sessionId: "s1",
      type: "error",
      code: "HELPER_START_TIMEOUT",
      message: "helper did not answer",
    });
    expect(t.controller.stateOf("s1")).toBe("idle");
    expect(t.hook.listenerCount).toBe(0);
    t.native.ctl.startError = null;
    await expect(t.startRecording()).resolves.toMatchObject({ sessionId: "s2" });
  });

  it("discard while the backend is starting discards the fresh session", async () => {
    const t = harness();
    let release: () => void = () => {};
    t.native.ctl.startGate = new Promise<void>((r) => {
      release = r;
    });
    await t.startRecording();
    await t.h["recording:discard"]({ sessionId: "s1" });
    release();
    await flush();
    expect(t.native.session.discard).toHaveBeenCalled();
    expect(t.controller.stateOf("s1")).toBe("discarded");
  });
});

describe("recording controller — interruptions never lose data", () => {
  it("disk < 500MB interrupts, stops the backend, keeps files and still finalizes", async () => {
    const t = harness();
    await t.startRecording();
    t.env.free = INTERRUPT_FREE_BYTES - 1;
    await t.timers.advanceAsync(3000);
    expect(t.controller.stateOf("s1")).toBe("interrupted");
    expect(t.events.find((e) => e.type === "interrupted")).toEqual({
      sessionId: "s1",
      type: "interrupted",
      reason: "diskLow",
      detail: undefined,
      recordedMs: 1000,
    });
    expect(t.native.session.stop).toHaveBeenCalledOnce();
    expect(t.removed).toEqual([]);
    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(fin.meta.interrupted).toBe("diskLow");
    expect(t.controller.stateOf("s1")).toBe("interrupted");
    expect(t.timers.pendingCount).toBe(0);
  });

  it("warns once when free space drops below 2 GB", async () => {
    const t = harness();
    await t.startRecording();
    t.env.free = GIB;
    await t.timers.advanceAsync(5000);
    expect(t.types().filter((x) => x === "diskLow")).toHaveLength(1);
    expect(t.controller.stateOf("s1")).toBe("recording");
  });

  it("an unreadable free-space value never interrupts a running recording (but blocks preparing)", async () => {
    const t = harness();
    await t.startRecording();
    t.deps.freeDiskBytes = async () => Promise.reject(new Error("EIO"));
    await t.timers.advanceAsync(5000);
    expect(t.controller.stateOf("s1")).toBe("recording");
    expect(t.types().filter((x) => x === "diskLow" || x === "interrupted")).toEqual([]);

    const blocked = harness();
    blocked.deps.freeDiskBytes = async () => Promise.reject(new Error("EIO"));
    await expect(blocked.h["recording:start"](REQ)).rejects.toThrow("EIO");
    expect(blocked.controller.stateOf("s1")).toBeNull();
  });

  it("helper crash → interrupted from paused, finalize keeps what reached disk", async () => {
    const t = harness();
    await t.startRecording();
    await t.timers.advanceAsync(2000);
    await t.h["recording:pause"]({ sessionId: "s1" });
    t.native.ctl.sink?.({ type: "interrupted", reason: "helperCrash", detail: "SIGSEGV" });
    await flush();
    expect(t.controller.stateOf("s1")).toBe("interrupted");
    await expect(t.h["recording:resume"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(fin.meta).toMatchObject({
      interrupted: "helperCrash",
      interruptedDetail: "SIGSEGV",
      durationMs: 2000,
    });
    expect(fin.meta.telemetryAligned).toBe(false);
  });

  it("display removal interrupts only sessions on that display", async () => {
    let fire: (id: string) => void = () => {};
    const t = harness({
      deps: {
        onDisplayRemoved: (l) => {
          fire = l;
          return () => {};
        },
      },
    });
    await t.startRecording();
    fire("d2");
    await flush();
    expect(t.controller.stateOf("s1")).toBe("recording");
    fire("d1");
    await flush();
    expect(t.events.at(-1)).toMatchObject({ type: "interrupted", reason: "displayDisconnected" });
  });

  it("deviceLost is forwarded without stopping", async () => {
    const t = harness();
    await t.startRecording();
    t.native.ctl.sink?.({ type: "deviceLost", device: "mic-1" });
    expect(t.events.at(-1)).toEqual({ sessionId: "s1", type: "deviceLost", device: "mic-1" });
    expect(t.controller.stateOf("s1")).toBe("recording");
  });

  it("finalize with no video on disk → NO_MEDIA and the session no longer blocks", async () => {
    const t = harness();
    t.sizes.clear();
    await t.startRecording();
    await t.h["recording:stop"]({ sessionId: "s1" });
    await expect(t.h["recording:finalize"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "NO_MEDIA",
    });
    expect(t.controller.stateOf("s1")).toBe("interrupted");
    await expect(t.h["recording:discard"]({ sessionId: "s1" })).resolves.toEqual({ ok: true });
    await expect(t.startRecording()).resolves.toMatchObject({ sessionId: "s2" });
  });
});

describe("recording controller — max length", () => {
  it("stops at the max length, excluding paused time", async () => {
    const t = harness();
    t.settings.maxLengthMs = 5000;
    await t.startRecording();
    await t.timers.advanceAsync(2000);
    await t.h["recording:pause"]({ sessionId: "s1" });
    await t.timers.advanceAsync(3000);
    await t.h["recording:resume"]({ sessionId: "s1" });
    await t.timers.advanceAsync(2500);
    expect(t.controller.stateOf("s1")).toBe("recording");
    await t.timers.advanceAsync(500);
    expect(t.controller.stateOf("s1")).toBe("finalizing");
    expect(t.events.find((e) => e.type === "stopped")).toEqual({
      sessionId: "s1",
      type: "stopped",
      recordedMs: 5000,
      reason: "maxLength",
    });
    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(fin.meta.stopReason).toBe("maxLength");
  });
});

describe("recording controller — state guards", () => {
  it("rejects illegal transitions and unknown sessions", async () => {
    const t = harness();
    await expect(t.h["recording:pause"]({ sessionId: "nope" })).rejects.toMatchObject({
      code: "NO_SESSION",
    });
    await t.h["recording:start"]({ ...REQ, countdown: 3 });
    await expect(t.h["recording:stop"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await t.timers.advanceAsync(3000);
    await expect(t.h["recording:resume"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(t.h["recording:finalize"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await t.h["recording:pause"]({ sessionId: "s1" });
    await expect(t.h["recording:pause"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await t.h["recording:stop"]({ sessionId: "s1" });
    await t.h["recording:finalize"]({ sessionId: "s1" });
    await expect(t.h["recording:discard"]({ sessionId: "s1" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("a failing helper pause leaves the state unchanged", async () => {
    const t = harness();
    await t.startRecording();
    vi.mocked(t.native.session.pause).mockRejectedValueOnce(new Error("HELPER_REQUEST_TIMEOUT"));
    await expect(t.h["recording:pause"]({ sessionId: "s1" })).rejects.toThrow();
    expect(t.controller.stateOf("s1")).toBe("recording");
  });

  it("writeChunk is refused for native backends", async () => {
    const t = harness();
    await t.startRecording();
    await expect(
      t.h["recording:writeChunk"]({ sessionId: "s1", track: "screen", chunk: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "WRONG_BACKEND" });
  });
});

describe("recording controller — dispose (app quit)", () => {
  it("stops a capturing session cleanly so its media can still be finalized", async () => {
    const t = harness();
    await t.startRecording();
    await t.timers.advanceAsync(2000);
    await t.controller.dispose();
    expect(t.native.session.stop).toHaveBeenCalledOnce();
    expect(t.native.session.discard).not.toHaveBeenCalled();
    expect(t.controller.stateOf("s1")).toBe("finalizing");
    expect(t.removed).toEqual([]);
    expect(t.timers.pendingCount).toBe(0);
    expect(t.hook.listenerCount).toBe(0);
    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(fin.meta.durationMs).toBe(2000);
  });

  it("cancels a countdown without ever starting the backend", async () => {
    const t = harness();
    await t.h["recording:start"]({ ...REQ, countdown: 5 });
    await t.controller.dispose();
    await t.timers.advanceAsync(10_000);
    expect(t.native.backend.start).not.toHaveBeenCalled();
    expect(t.controller.stateOf("s1")).toBe("discarded");
    expect(t.removed).toEqual(["/rec/s1"]);
    expect(t.timers.pendingCount).toBe(0);
  });

  it("a backend still starting at dispose is discarded, not left running", async () => {
    const t = harness();
    let release: () => void = () => {};
    t.native.ctl.startGate = new Promise<void>((r) => {
      release = r;
    });
    await t.startRecording();
    await t.controller.dispose();
    release();
    await flush();
    expect(t.native.session.discard).toHaveBeenCalled();
    expect(t.controller.stateOf("s1")).toBe("discarded");
  });
});

describe("recording controller — Electron backend", () => {
  function electronHarness(deps: Partial<RecordingDeps> = {}) {
    const disk = new Map<string, number[]>();
    const electron = createElectronBackend({
      join: (...p) => p.join("/"),
      getSources: async () => SOURCES,
      openWriter: async (path): Promise<TrackWriter> => {
        disk.set(path, []);
        return {
          write: async (b) => {
            disk.get(path)?.push(...b);
          },
          close: async () => {},
        };
      },
    });
    const t = harness({
      backends: [electron],
      deps: {
        platform: "linux",
        fileSize: async (p) => disk.get(p)?.length ?? null,
        ...deps,
      },
    });
    return { ...t, disk };
  }

  it("streams chunks to disk, accepts the final flush after stop, and aligns telemetry", async () => {
    const t = electronHarness();
    await expect(
      t.h["recording:start"]({ ...REQ, countdown: 3 }).then(async (r) => {
        await expect(
          t.h["recording:writeChunk"]({
            sessionId: r.sessionId,
            track: "screen",
            chunk: new Uint8Array([0]),
          }),
        ).rejects.toMatchObject({ code: "INVALID_STATE" });
        return r;
      }),
    ).resolves.toMatchObject({ backend: "electron" });
    await t.timers.advanceAsync(3000); // recording starts at t=3000
    t.hook.emit("mousemove", { x: 0, y: 0 }); // before the first frame → dropped
    await t.timers.advanceAsync(100);
    await t.h["recording:writeChunk"]({
      sessionId: "s1",
      track: "screen",
      chunk: new Uint8Array([1, 2]).buffer,
      timing: { timeOriginMs: EPOCH_MS, recorderStartMs: 3050 },
    });
    await t.timers.advanceAsync(150); // t=3250
    t.hook.emit("mousemove", { x: 250, y: 125 });
    t.hook.emit("keydown", { keycode: 0x1e }); // "a" — plain typing
    t.hook.emit("keydown", { keycode: 0x1e, metaKey: true }); // ⌘A
    await t.h["recording:writeChunk"]({
      sessionId: "s1",
      track: "mic",
      chunk: new Uint8Array([9]),
    });
    await t.h["recording:stop"]({ sessionId: "s1" });
    await t.h["recording:writeChunk"]({
      sessionId: "s1",
      track: "screen",
      chunk: new Uint8Array([3]),
    });

    const fin = await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(t.disk.get("/rec/s1/screen.webm")).toEqual([1, 2, 3]);
    expect(fin.video).toEqual({ path: "/rec/s1/screen.webm", bytes: 3 });
    expect(fin.mic).toEqual({ path: "/rec/s1/mic.webm", bytes: 1 });
    expect(fin.meta.backend).toBe("electron");
    expect(fin.meta.telemetryAligned).toBe(true);
    const tel = t.telemetryOf();
    expect(tel.points).toEqual([[200, 0.25, 0.25, "arrow"]]);
    expect(tel.keys).toEqual([[200, 0x1e, 8]]);

    await expect(
      t.h["recording:writeChunk"]({ sessionId: "s1", track: "screen", chunk: new Uint8Array([4]) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("keeps typed text when the user opted in", async () => {
    const t = electronHarness();
    t.settings.keepTypedText = true;
    await t.startRecording();
    await t.h["recording:writeChunk"]({
      sessionId: "s1",
      track: "screen",
      chunk: new Uint8Array([1]),
      timing: { timeOriginMs: EPOCH_MS, recorderStartMs: 0 },
    });
    t.hook.emit("keydown", { keycode: 0x1e });
    await t.h["recording:stop"]({ sessionId: "s1" });
    await t.h["recording:finalize"]({ sessionId: "s1" });
    expect(t.telemetryOf().keys).toEqual([[0, 0x1e, 0]]);
  });
});
