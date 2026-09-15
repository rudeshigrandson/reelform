import { projectV1Schema } from "../../editor/model/v1";
import { warningCopy } from "../../recording/sessionStore";
import type { RecordingBusMessage } from "./bus";
import { createMemoryBusHub } from "./bus";
import type { RecordingSetup } from "./document";
import { type RecordingFlowDeps, createRecordingFlow } from "./flow";
import {
  FakeAppPort,
  FakeProjects,
  FakeSystem,
  FakeWindows,
  SOURCES,
  drain,
  fakeCaptureFactory,
  finalizeFixture,
} from "./testFakes";

const SETUP: RecordingSetup = {
  sourceId: "d1",
  mode: "screen",
  mic: true,
  micDeviceId: "mic-usb",
  systemAudio: false,
  webcam: false,
  fps: 60,
  countdown: 3,
  hideCursor: false,
};

function harness(overrides: Partial<RecordingFlowDeps> = {}) {
  const log: string[] = [];
  const port = new FakeAppPort();
  const windows = new FakeWindows();
  const projects = new FakeProjects();
  const system = new FakeSystem();
  const capture = fakeCaptureFactory(log);
  const hub = createMemoryBusHub();
  const bus = hub.endpoint();
  const other = hub.endpoint();
  const otherSeen: RecordingBusMessage[] = [];
  other.subscribe((m) => otherSeen.push(m));
  let openEditor = true;
  let ids = 0;
  // Record the order of port/capture/project calls in one log.
  const origFinalize = port.finalize.bind(port);
  port.finalize = (id) => {
    log.push("finalize");
    return origFinalize(id);
  };
  const origCreate = projects.create.bind(projects);
  projects.create = (req) => {
    log.push("create");
    return origCreate(req);
  };
  const flow = createRecordingFlow({
    port,
    windows,
    projects,
    system,
    startCapture: capture.startCapture,
    platform: "darwin",
    appVersion: "1.0.0",
    newId: () => `p${++ids}`,
    nowIso: () => "2026-09-15T14:32:05.000Z",
    openEditorAfterRecording: () => openEditor,
    sources: () => SOURCES,
    bus,
    ...overrides,
  });
  const state = () => flow.store.getState();
  const emit = port.emit.bind(port);
  const s1 = "s1";
  return {
    log,
    port,
    windows,
    projects,
    system,
    capture,
    flow,
    state,
    emit,
    other,
    otherSeen,
    s1,
    setOpenEditor: (v: boolean) => {
      openEditor = v;
    },
  };
}

async function toRecording(t: ReturnType<typeof harness>, setup: RecordingSetup = SETUP) {
  await t.flow.start(setup);
  t.emit({ sessionId: "s1", type: "started", backend: "electron" });
  await drain();
}

describe("recording flow — happy path", () => {
  it("start → countdown → capture → pause/resume → stop → flush → finalize → create → editor", async () => {
    const t = harness();
    t.port.emitBeforeStartReply = [{ sessionId: "s1", type: "countdown", remaining: 3 }];
    await t.flow.start(SETUP);
    expect(t.port.lastStart).toEqual({
      source: { kind: "display", id: "d1" },
      audio: { system: false, mic: "mic-usb" },
      fps: 60,
      countdown: 3,
      hideCursor: false,
    });
    expect(t.state()).toMatchObject({ phase: "countdown", sessionId: "s1", countdownRemaining: 3 });
    expect(t.windows.calls).toEqual(["openHud:d1", "openCountdown:d1"]);

    t.emit({ sessionId: "s1", type: "countdown", remaining: 2 });
    expect(t.state().countdownRemaining).toBe(2);
    t.emit({ sessionId: "other", type: "started", backend: "electron" });
    expect(t.state().phase).toBe("countdown");

    t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await drain();
    expect(t.state().phase).toBe("recording");
    expect(t.windows.calls).toContain("closeKind:countdown");
    const cap = t.capture.sessions[0];
    expect(cap?.options).toMatchObject({
      sessionId: "s1",
      platform: "darwin",
      desktop: { sourceId: "screen:1:0", scaleFactor: 2 },
      mic: { deviceId: "mic-usb" },
    });
    expect(cap?.hooks.port).toBe(t.port);

    t.emit({ sessionId: "s1", type: "paused", elapsedMs: 1000 });
    await drain();
    expect(t.state().phase).toBe("paused");
    t.emit({ sessionId: "s1", type: "resumed", elapsedMs: 1000 });
    await drain();
    t.emit({
      sessionId: "s1",
      type: "stats",
      elapsedMs: 4200,
      fps: 60,
      droppedFrames: 0,
      fileBytes: 1,
    });
    expect(t.state().elapsedMs).toBe(4200);

    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 42_180, reason: "user" });
    await drain(60);
    expect(t.log).toEqual([
      "capture.start",
      "capture.pause",
      "capture.resume",
      "capture.stop",
      "finalize",
      "create",
    ]);
    const req = t.projects.created[0];
    expect(req?.name).toBe("Recording 2026-09-15 at 14.32.05");
    expect(req?.media?.every((m) => m.move === true)).toBe(true);
    expect(req?.media?.map((m) => m.fileName)).toEqual([
      "screen.webm",
      "mic.webm",
      "telemetry.json.gz",
    ]);
    expect(projectV1Schema.safeParse(req?.document).success).toBe(true);
    expect((req?.document as { sources: { mic: { codec: string } } }).sources.mic.codec).toBe(
      "opus",
    );
    expect(t.windows.calls).toContain("openEditor:p1");
    expect(t.windows.calls).toContain("closeKind:hud");
    expect(t.state()).toMatchObject({
      phase: "done",
      result: {
        projectId: "p1",
        projectPath: "/Projects/Recording 2026-09-15 at 14.32.05.reelform",
        durationMs: 42_180,
        interrupted: null,
        openedEditor: true,
      },
    });
    expect(t.port.listeners.size).toBe(0);
  });

  it("post-record card: reveal, delete and record another via the SystemPort", async () => {
    const t = harness();
    t.setOpenEditor(false);
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    expect(t.state()).toMatchObject({ phase: "done", result: { openedEditor: false } });
    expect(t.windows.calls.some((c) => c.startsWith("openEditor"))).toBe(false);
    const path = t.state().result?.projectPath ?? "";

    await t.flow.reveal();
    expect(t.system.calls).toEqual([`reveal:${path}`]);
    await t.flow.openInEditor();
    expect(t.state().result?.openedEditor).toBe(true);

    t.system.fail = { code: "TRASH_FAILED", message: "nope" };
    await t.flow.deleteRecording();
    expect(t.state()).toMatchObject({
      phase: "done",
      error: { code: "TRASH_FAILED", stage: "delete" },
    });
    t.system.fail = null;
    await t.flow.deleteRecording();
    expect(t.state().phase).toBe("idle");
    expect(t.state().result).toBeNull();
  });

  it("record another returns to idle and can start again", async () => {
    const t = harness();
    t.setOpenEditor(false);
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    await t.flow.recordAnother();
    expect(t.state().phase).toBe("idle");
    t.port.startResult = { sessionId: "s2", backend: "electron", backendReasons: [] };
    await t.flow.start({ ...SETUP, countdown: 0 });
    expect(t.state()).toMatchObject({ phase: "starting", sessionId: "s2" });
  });

  it("native backends never start renderer capture", async () => {
    const t = harness();
    t.port.startResult = { sessionId: "s1", backend: "sck", backendReasons: [] };
    await t.flow.start({ ...SETUP, countdown: 0 });
    t.emit({ sessionId: "s1", type: "started", backend: "sck" });
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    expect(t.log).toEqual(["finalize", "create"]);
    expect(t.state().phase).toBe("done");
  });

  it("webcam on opens the bubble; stop closes it", async () => {
    const t = harness();
    await toRecording(t, { ...SETUP, webcam: true, webcamDeviceId: "cam-1" });
    expect(t.windows.calls).toContain("openWebcamBubble");
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    expect(t.windows.calls).toContain("closeKind:webcam-bubble");
  });
});

describe("recording flow — failures", () => {
  it.each([
    ["PERMISSION_DENIED", { missing: ["screen"] }],
    ["DISK_LOW", { freeBytes: 1 }],
    ["SESSION_ACTIVE", undefined],
    ["BACKEND_UNAVAILABLE", { reasons: ["sck: helper missing"] }],
  ])("start rejected with %s → error state, no windows, no listeners", async (code, details) => {
    const t = harness();
    t.port.startError = { code, message: "x", details };
    await t.flow.start(SETUP);
    expect(t.state()).toMatchObject({
      phase: "error",
      error: details === undefined ? { code, stage: "start" } : { code, stage: "start", details },
    });
    expect(t.windows.calls).toEqual([]);
    expect(t.port.listeners.size).toBe(0);
    await t.flow.retry();
    expect(t.state().phase).toBe("idle");
  });

  it("renderer capture permission denied → discards the session and closes windows", async () => {
    const t = harness();
    t.capture.fail({ code: "NotAllowedError", message: "Permission denied" });
    await toRecording(t);
    expect(t.state()).toMatchObject({
      phase: "error",
      error: { code: "NotAllowedError", stage: "capture" },
    });
    expect(t.port.calls).toContain("discard:s1");
    expect(t.windows.calls).toEqual(
      expect.arrayContaining(["closeKind:hud", "closeKind:countdown", "closeKind:webcam-bubble"]),
    );
  });

  it("a display without a desktop-capture id cannot be captured", async () => {
    const t = harness({
      sources: () => ({
        ...SOURCES,
        displays: [{ ...SOURCES.displays[0], mediaSourceId: undefined } as never],
      }),
    });
    await toRecording(t);
    expect(t.state()).toMatchObject({ phase: "error", error: { code: "SOURCE_NOT_CAPTURABLE" } });
    expect(t.log).toEqual([]);
    expect(t.port.calls).toContain("discard:s1");
  });

  it("interrupted (disk low) flushes what was captured, keeps it and shows the card instead of the editor", async () => {
    const t = harness();
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "diskLow", freeBytes: 10 });
    expect(t.state().warnings).toEqual(["diskLow"]);
    t.port.finalizeResult = finalizeFixture({ interrupted: "diskLow", durationMs: 42_000 });
    t.emit({ sessionId: "s1", type: "interrupted", reason: "diskLow", elapsedMs: 42_000 });
    await drain(60);
    expect(t.log).toEqual(["capture.start", "capture.stop", "finalize", "create"]);
    expect(t.state()).toMatchObject({
      phase: "done",
      interrupted: { reason: "diskLow", message: "The disk ran out of space", elapsedMs: 42_000 },
      result: { openedEditor: false, interrupted: { reason: "diskLow" }, durationMs: 42_000 },
    });
    expect(t.windows.calls.some((c) => c.startsWith("openEditor"))).toBe(false);
    // Later stray events do not finalize twice.
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 42_000, reason: "user" });
    await drain(30);
    expect(t.log.filter((l) => l === "finalize")).toHaveLength(1);
  });

  it("interrupted then stopped while finalizing finalizes once", async () => {
    const t = harness();
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 1, reason: "user" });
    t.emit({ sessionId: "s1", type: "interrupted", reason: "helperCrash", elapsedMs: 1 });
    await drain(60);
    expect(t.log.filter((l) => l === "finalize")).toHaveLength(1);
    expect(t.log.filter((l) => l === "capture.stop")).toHaveLength(1);
  });

  it("finalize failure → retry finalizes again, then creates the project", async () => {
    const t = harness();
    await toRecording(t);
    t.port.finalizeErrors = [{ code: "NO_MEDIA", message: "no video reached disk" }];
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 1, reason: "user" });
    await drain(60);
    expect(t.state()).toMatchObject({
      phase: "error",
      error: { code: "NO_MEDIA", stage: "finalize" },
    });
    await t.flow.retry();
    await drain(30);
    expect(t.log).toEqual(["capture.start", "capture.stop", "finalize", "finalize", "create"]);
    expect(t.state().phase).toBe("done");
  });

  it("project:create failure keeps the finalized recording for retry (no second finalize)", async () => {
    const t = harness();
    await toRecording(t);
    t.projects.createErrors = [{ code: "DISK_FULL", message: "no space" }];
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 1, reason: "user" });
    await drain(60);
    expect(t.state()).toMatchObject({
      phase: "error",
      error: { code: "DISK_FULL", stage: "create" },
    });
    await t.flow.retry();
    await drain(30);
    expect(t.log.filter((l) => l === "finalize")).toHaveLength(1);
    expect(t.log.filter((l) => l === "create")).toHaveLength(2);
    expect(t.state().phase).toBe("done");
  });

  it("uniquified media names are written back with project:save", async () => {
    const t = harness();
    t.projects.renameMedia = (n) => (n === "screen.webm" ? "screen (1).webm" : n);
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 1, reason: "user" });
    await drain(60);
    const saved = t.projects.saved[0]?.document as { sources: { video: { path: string } } };
    expect(saved.sources.video.path).toBe("media/screen (1).webm");
  });

  it("opening the editor can fail; the card stays usable and retry opens it", async () => {
    const t = harness();
    t.windows.failOn.add("openEditor");
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 1, reason: "user" });
    await drain(60);
    expect(t.state()).toMatchObject({
      phase: "done",
      result: { openedEditor: false },
      error: { stage: "openEditor" },
    });
    t.windows.failOn.clear();
    await t.flow.retry();
    expect(t.state()).toMatchObject({ result: { openedEditor: true }, error: null });
  });

  it("discarded from the HUD releases capture, closes windows and returns to idle", async () => {
    const t = harness();
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "discarded" });
    await drain();
    expect(t.log).toEqual(["capture.start", "capture.discard"]);
    expect(t.state()).toMatchObject({ phase: "idle", sessionId: null });
    expect(t.port.listeners.size).toBe(0);
  });

  it("main start failure after the countdown → error, windows closed", async () => {
    const t = harness();
    await t.flow.start(SETUP);
    t.emit({ sessionId: "s1", type: "error", code: "SCK_DENIED", message: "denied" });
    expect(t.state()).toMatchObject({
      phase: "error",
      error: { code: "SCK_DENIED", stage: "start" },
    });
    expect(t.windows.calls).toContain("closeKind:hud");
  });

  it("cancel during the countdown discards in main", async () => {
    const t = harness();
    await t.flow.start(SETUP);
    await t.flow.cancel();
    expect(t.port.calls).toContain("discard:s1");
    t.emit({ sessionId: "s1", type: "discarded" });
    expect(t.state().phase).toBe("idle");
  });

  it("ignores a second start while a session is live", async () => {
    const t = harness();
    await t.flow.start(SETUP);
    await t.flow.start(SETUP);
    expect(t.port.calls.filter((c) => c === "start")).toHaveLength(1);
  });
});

describe("recording flow — region + bus", () => {
  it("region: overlays select → close → start with the region on that display", async () => {
    const t = harness();
    await t.flow.selectRegion({ ...SETUP, mode: "region" });
    expect(t.state().phase).toBe("selectingRegion");
    expect(t.windows.calls).toEqual([
      "openRegionOverlays",
      "setRegionSelecting:d1:true",
      "setRegionSelecting:d2:true",
    ]);
    t.other.post({
      type: "regionSelected",
      displayId: "d2",
      region: { x: 10, y: 20, width: 640, height: 360 },
      pixelRegion: { x: 10, y: 20, width: 640, height: 360 },
      scaleFactor: 1,
    });
    await drain(30);
    expect(t.windows.calls).toContain("closeKind:region-overlay");
    expect(t.port.lastStart).toMatchObject({
      source: { kind: "display", id: "d2" },
      region: { x: 10, y: 20, width: 640, height: 360 },
    });
    expect(t.windows.calls).toContain("openHud:d2");
  });

  it("region cancelled on any display returns to idle without starting", async () => {
    const t = harness();
    await t.flow.selectRegion({ ...SETUP, mode: "region" });
    t.other.post({ type: "regionCancelled", displayId: "d1" });
    await drain(30);
    expect(t.state().phase).toBe("idle");
    expect(t.port.calls).not.toContain("start");
    expect(t.windows.calls).toContain("closeKind:region-overlay");
  });

  it("answers snapshot requests from other windows and publishes changes", async () => {
    const t = harness();
    t.other.post({ type: "snapshotRequest" });
    await drain();
    expect(t.otherSeen.at(-1)).toEqual({ type: "snapshot", snapshot: null });
    await t.flow.start(SETUP);
    await drain();
    const last = t.otherSeen.filter((m) => m.type === "snapshot").at(-1);
    expect(last).toEqual({
      type: "snapshot",
      snapshot: {
        sessionId: "s1",
        phase: "countdown",
        countdownRemaining: 3,
        countdownTotal: 3,
        sourceLabel: "Studio Display",
        displayId: "d1",
        webcamDeviceId: null,
        setup: SETUP,
      },
    });
  });

  it("relays renderer mic level and capture warnings to other windows", async () => {
    const t = harness();
    await toRecording(t);
    t.capture.sessions[0]?.hooks.onMicLevel?.(0.7);
    t.capture.sessions[0]?.hooks.onError?.({ code: "WRITE_FAILED", message: "x" }, "mic");
    await drain();
    expect(t.otherSeen).toEqual(
      expect.arrayContaining([
        { type: "micLevel", sessionId: "s1", level: 0.7 },
        { type: "warning", sessionId: "s1", code: "capture-error" },
      ]),
    );
    // Raw error codes never reach the user-facing warning list.
    expect(t.state().warnings).toEqual(["capture-error"]);
  });

  it("maxLength stop and known warning codes surface with user copy", async () => {
    const t = harness();
    await toRecording(t);
    t.capture.sessions[0]?.hooks.onError?.({ code: "diskLow", message: "x" }, "screen");
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "maxLength" });
    expect(t.state().warnings).toEqual(["diskLow", "maxLength"]);
    expect(warningCopy("maxLength")).toBe("Maximum recording length reached");
    expect(warningCopy("capture-error")).not.toBe("capture-error");
  });

  it("callbacks from a discarded capture do not leak into the next session", async () => {
    const t = harness();
    await toRecording(t);
    const stale = t.capture.sessions[0];
    t.emit({ sessionId: "s1", type: "discarded" });
    await drain();
    t.port.startResult = { sessionId: "s2", backend: "electron", backendReasons: [] };
    await t.flow.start({ ...SETUP, countdown: 0 });
    t.otherSeen.length = 0;
    stale?.hooks.onError?.({ code: "INVALID_STATE", message: "late" }, "screen");
    stale?.hooks.onDeviceLost?.("mic");
    stale?.hooks.onMicLevel?.(0.9);
    await drain();
    expect(t.state()).toMatchObject({ sessionId: "s2", warnings: [] });
    expect(t.otherSeen.filter((m) => m.type === "micLevel" || m.type === "warning")).toEqual([]);
  });
});

describe("recording flow — pre-record HUD start requests", () => {
  it("startRequest over the bus starts like the launcher's Record", async () => {
    const t = harness();
    t.other.post({ type: "startRequest", setup: SETUP });
    await drain();
    expect(t.port.lastStart).toMatchObject({ source: { kind: "display", id: "d1" }, fps: 60 });
    expect(t.state()).toMatchObject({ phase: "countdown", sessionId: "s1" });
    expect(t.otherSeen).toContainEqual(
      expect.objectContaining({
        type: "snapshot",
        snapshot: expect.objectContaining({ phase: "starting" }),
      }),
    );
  });

  it("region startRequest opens the selection overlays first", async () => {
    const t = harness();
    t.other.post({ type: "startRequest", setup: { ...SETUP, mode: "region" } });
    await drain();
    expect(t.state().phase).toBe("selectingRegion");
    expect(t.port.calls).not.toContain("start");
    expect(t.windows.calls).toContain("openRegionOverlays");
  });

  it("a startRequest while a session is live is ignored", async () => {
    const t = harness();
    await toRecording(t);
    const starts = t.port.calls.filter((c) => c === "start").length;
    t.other.post({ type: "startRequest", setup: { ...SETUP, sourceId: "d2" } });
    await drain();
    expect(t.port.calls.filter((c) => c === "start")).toHaveLength(starts);
    expect(t.state().phase).toBe("recording");
  });

  it("ignored after dispose", async () => {
    const t = harness();
    t.flow.dispose();
    t.other.post({ type: "startRequest", setup: SETUP });
    await drain();
    expect(t.port.calls).not.toContain("start");
  });
});

describe("recording flow — native webcam, mic label, mute, editor defaults", () => {
  const nativeStart = async (t: ReturnType<typeof harness>, setup: RecordingSetup) => {
    t.port.startResult = { sessionId: "s1", backend: "sck", backendReasons: [] };
    await t.flow.start({ ...setup, countdown: 0 });
    t.emit({ sessionId: "s1", type: "started", backend: "sck" });
    await drain();
  };

  it("records the webcam in the renderer beside a native helper and flushes it before finalize", async () => {
    const t = harness();
    await nativeStart(t, { ...SETUP, webcam: true, webcamDeviceId: "cam-1", systemAudio: true });
    expect(t.capture.sessions).toHaveLength(1);
    expect(t.capture.sessions[0]?.options).toEqual({
      sessionId: "s1",
      platform: "darwin",
      fps: 60,
      systemAudio: false,
      webcam: { deviceId: "cam-1" },
    });
    t.emit({ sessionId: "s1", type: "paused", elapsedMs: 10 });
    await drain();
    expect(t.log).toContain("capture.pause");
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 20, reason: "user" });
    await drain(60);
    expect(t.log.slice(-3)).toEqual(["capture.stop", "finalize", "create"]);
    expect(t.state().phase).toBe("done");
  });

  it("a failed native webcam capture is a warning; the recording still finalizes", async () => {
    const t = harness();
    t.capture.fail({ code: "NotReadableError", message: "camera busy" });
    await nativeStart(t, { ...SETUP, webcam: true });
    expect(t.state().phase).toBe("recording");
    expect(t.state().warnings.length).toBe(1);
    expect(t.port.calls).not.toContain("discard:s1");
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 20, reason: "user" });
    await drain(60);
    expect(t.state().phase).toBe("done");
  });

  it("resolves the mic label before recording:start", async () => {
    const t = harness({
      enumerateDevices: async () => [
        { deviceId: "default", kind: "audioinput", label: "Default - MacBook Pro Microphone" },
        { deviceId: "mic-usb", kind: "audioinput", label: "Shure MV7" },
      ],
    });
    await t.flow.start(SETUP);
    expect(t.port.lastStart?.audio).toEqual({
      system: false,
      mic: "mic-usb",
      micLabel: "Shure MV7",
    });
    expect(t.state().setup?.micLabel).toBe("Shure MV7");
  });

  it("starts without a label when devices cannot be listed", async () => {
    const t = harness({
      enumerateDevices: async () => {
        throw new Error("denied");
      },
    });
    await t.flow.start(SETUP);
    expect(t.port.lastStart?.audio).toEqual({ system: false, mic: "mic-usb" });
  });

  it("HUD mute on the Electron backend disables the renderer mic, also when requested before capture", async () => {
    const muted: boolean[] = [];
    const base = fakeCaptureFactory([]);
    const t = harness({
      startCapture: async (options, hooks) => {
        const session = await base.startCapture(options, hooks);
        return Object.assign(session, { setMicMuted: (m: boolean) => muted.push(m) });
      },
    });
    await t.flow.start(SETUP);
    t.other.post({ type: "hud:setMicMuted", muted: true } as unknown as RecordingBusMessage);
    await drain();
    expect(muted).toEqual([]);
    t.emit({ sessionId: "s1", type: "started", backend: "electron" });
    await drain();
    expect(muted).toEqual([true]);
    t.other.post({ type: "hud:setMicMuted", muted: false } as unknown as RecordingBusMessage);
    await drain();
    expect(muted).toEqual([true, false]);
  });

  it("native mute goes through recording:setMicMuted once the helper started; failures warn", async () => {
    const t = harness();
    const calls: [string, boolean][] = [];
    let fail = false;
    Object.assign(t.port, {
      setMicMuted: async (id: string, m: boolean) => {
        calls.push([id, m]);
        if (fail) throw { code: "MIC_MUTE_FAILED", message: "nope" };
      },
    });
    t.port.startResult = { sessionId: "s1", backend: "sck", backendReasons: [] };
    await t.flow.start(SETUP);
    await t.flow.setMicMuted(true);
    expect(calls).toEqual([]);
    t.emit({ sessionId: "s1", type: "started", backend: "sck" });
    await drain();
    expect(calls).toEqual([["s1", true]]);
    fail = true;
    await t.flow.setMicMuted(false);
    expect(calls).toEqual([
      ["s1", true],
      ["s1", false],
    ]);
    expect(t.state().warnings).toHaveLength(1);
  });

  it("applies the settings frame preset and aspect to the created project", async () => {
    const t = harness({ editorDefaults: () => ({ framePreset: "minimal", aspect: "9:16" }) });
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    const doc = t.projects.created[0]?.document as {
      frame: { aspect: { preset: string }; background: { kind: string } };
    };
    expect(projectV1Schema.safeParse(doc).success).toBe(true);
    expect(doc.frame.aspect.preset).toBe("9:16");
    expect(doc.frame.background.kind).toBe("color");
  });

  it("imports the finalize thumbnail with the project", async () => {
    const t = harness();
    t.port.finalizeResult = { ...finalizeFixture(), thumbnailPath: "/rec/s1/thumbnail.jpg" };
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    expect(t.projects.created[0]?.media?.at(-1)).toMatchObject({
      sourcePath: "/rec/s1/thumbnail.jpg",
      fileName: "thumbnail.jpg",
    });
    expect(t.state().phase).toBe("done");
  });
});

describe("recording flow — HUD restart", () => {
  it("snapshots carry the setup, so the pill can Restart a launcher-started recording", async () => {
    const t = harness();
    await toRecording(t);
    await drain();
    const last = t.otherSeen.filter((m) => m.type === "snapshot").at(-1);
    expect(last).toMatchObject({ snapshot: { phase: "recording", setup: SETUP } });
  });

  it("hud:restart discards keeping the HUD open, then starts again with the same setup", async () => {
    const t = harness();
    await toRecording(t);
    const firstStart = t.port.lastStart;
    t.windows.calls.length = 0;
    t.other.post({ type: "hud:restart" });
    await drain();
    expect(t.port.calls).toContain("discard:s1");
    expect(t.port.calls.filter((c) => c === "start")).toHaveLength(1);
    t.emit({ sessionId: "s1", type: "discarded" });
    await drain();
    expect(t.log).toEqual(["capture.start", "capture.discard"]);
    expect(t.port.calls.filter((c) => c === "start")).toHaveLength(2);
    expect(t.port.lastStart).toEqual(firstStart);
    expect(t.windows.calls).not.toContain("closeKind:hud");
    expect(t.windows.calls).toContain("closeKind:countdown");
    expect(t.state()).toMatchObject({ phase: "countdown", sessionId: "s1", setup: SETUP });
    // A plain discard of the new session closes the HUD again.
    t.emit({ sessionId: "s1", type: "discarded" });
    await drain();
    expect(t.windows.calls).toContain("closeKind:hud");
    expect(t.state().phase).toBe("idle");
  });

  it("restarting a region recording re-opens the region selection", async () => {
    const t = harness();
    const region = {
      ...SETUP,
      mode: "region" as const,
      region: { x: 0, y: 0, width: 10, height: 10 },
    };
    await toRecording(t, region);
    t.other.post({ type: "hud:restart" });
    await drain();
    t.emit({ sessionId: "s1", type: "discarded" });
    await drain();
    expect(t.state().phase).toBe("selectingRegion");
    expect(t.windows.calls).toContain("openRegionOverlays");
    expect(t.port.calls.filter((c) => c === "start")).toHaveLength(1);
  });

  it("a failed discard keeps the session and cancels the restart", async () => {
    const t = harness();
    await toRecording(t);
    t.port.discardError = { code: "DISCARD_FAILED", message: "nope" };
    t.other.post({ type: "hud:restart" });
    await drain();
    expect(t.state()).toMatchObject({ phase: "recording", error: { code: "DISCARD_FAILED" } });
    t.emit({ sessionId: "s1", type: "discarded" });
    await drain();
    expect(t.state().phase).toBe("idle");
    expect(t.port.calls.filter((c) => c === "start")).toHaveLength(1);
  });

  it("is ignored without a live session", async () => {
    const t = harness();
    t.other.post({ type: "hud:restart" });
    await drain();
    expect(t.port.calls).toEqual([]);
  });
});

describe("recording flow — background transcode relink", () => {
  const done = (outputPath: string | null, extra: { error?: string } = {}) => ({
    sessionId: "s1",
    progress: 1,
    done: true,
    outputPath,
    ...extra,
  });

  async function recorded(t: ReturnType<typeof harness>) {
    await toRecording(t);
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 42_180, reason: "user" });
    await drain(60);
    expect(t.state().phase).toBe("done");
  }

  it("relinks the project's screen video to the H.264 sibling and saves the document", async () => {
    const t = harness();
    await recorded(t);
    expect(t.port.transcodeListeners.size).toBe(1);
    const projectPath = t.state().result?.projectPath ?? "";
    t.port.emitTranscode({ sessionId: "s1", progress: 0.4, done: false, outputPath: null });
    t.port.emitTranscode({ ...done(null), sessionId: "other" });
    await drain();
    expect(t.projects.relinked).toEqual([]);
    t.port.emitTranscode(done("/rec/s1/screen.h264.mp4"));
    await drain();
    expect(t.projects.relinked).toEqual([
      {
        path: projectPath,
        filePath: "/rec/s1/screen.h264.mp4",
        expected: { durationMs: 42_180 },
        mode: "copy",
      },
    ]);
    const doc = t.projects.saved.at(-1)?.document as {
      sources: { video: { path: string; codec: string; durationMs: number } };
    };
    expect(t.projects.saved.at(-1)?.path).toBe(projectPath);
    expect(projectV1Schema.safeParse(doc).success).toBe(true);
    expect(doc.sources.video).toMatchObject({ path: "media/screen.h264.mp4", codec: "h264" });
    expect(t.port.transcodeListeners.size).toBe(0);
  });

  it("patches the document as currently saved, keeping edits made after create", async () => {
    const logged: string[] = [];
    const t = harness({ log: (m) => logged.push(m) });
    await recorded(t);
    const projectPath = t.state().result?.projectPath ?? "";
    const created = t.projects.created[0]?.document as { name: string };
    t.projects.saved.push({ path: projectPath, document: { ...created, name: "Edited" } });
    t.port.emitTranscode(done("/rec/s1/screen.h264.mp4"));
    await drain();
    const doc = t.projects.saved.at(-1)?.document as {
      name: string;
      sources: { video: { path: string; codec: string } };
    };
    expect(doc.name).toBe("Edited");
    expect(doc.sources.video).toMatchObject({ path: "media/screen.h264.mp4", codec: "h264" });

    // The user replaced the video in the meantime: nothing is saved over it.
    const u = harness({ log: (m) => logged.push(m) });
    await recorded(u);
    const uPath = u.state().result?.projectPath ?? "";
    const base = u.projects.saved.at(-1)?.document ?? u.projects.created[0]?.document;
    const b = base as { sources: { video: object } };
    const replaced = {
      ...b,
      sources: { ...b.sources, video: { ...b.sources.video, path: "/x.mp4" } },
    };
    u.projects.saved.push({ path: uPath, document: replaced });
    const savedBefore = u.projects.saved.length;
    u.port.emitTranscode(done("/rec/s1/screen.h264.mp4"));
    await drain();
    expect(u.projects.saved).toHaveLength(savedBefore);
    expect(logged.at(-1)).toContain("replaced");
  });

  it("a transcode that finishes before the project exists relinks once it is created", async () => {
    const t = harness();
    const create = t.projects.create.bind(t.projects);
    t.projects.create = async (req) => {
      t.port.emitTranscode(done("/rec/s1/screen.h264.mp4"));
      return create(req);
    };
    await recorded(t);
    expect(t.projects.relinked).toHaveLength(1);
    expect(t.projects.saved).toHaveLength(1);
  });

  it("failed transcodes and failed relinks are logged; the project keeps its video", async () => {
    const logged: string[] = [];
    const t = harness({ log: (m) => logged.push(m) });
    await recorded(t);
    t.port.emitTranscode(done(null, { error: "ffmpeg exited 1" }));
    await drain();
    expect(t.projects.relinked).toEqual([]);
    expect(t.port.transcodeListeners.size).toBe(0);
    expect(logged).toEqual([expect.stringContaining("ffmpeg exited 1")]);

    const u = harness({ log: (m) => logged.push(m) });
    u.projects.relinkError = { code: "RELINK_DURATION_MISMATCH", message: "duration" };
    await recorded(u);
    u.port.emitTranscode(done("/rec/s1/screen.h264.mp4"));
    await drain();
    expect(u.projects.relinked).toHaveLength(1);
    expect(u.projects.saved).toEqual([]);
    expect(logged.at(-1)).toContain("RELINK_DURATION_MISMATCH");
  });

  it("native recordings and H.264 captures are not watched", async () => {
    const t = harness();
    t.port.startResult = { sessionId: "s1", backend: "sck", backendReasons: [] };
    t.port.finalizeResult = finalizeFixture({ backend: "sck" });
    await t.flow.start(SETUP);
    t.emit({ sessionId: "s1", type: "started", backend: "sck" });
    t.emit({ sessionId: "s1", type: "stopped", elapsedMs: 5, reason: "user" });
    await drain(60);
    expect(t.port.transcodeListeners.size).toBe(0);

    const u = harness({
      startCapture: async (options, hooks) => {
        const s = await fakeCaptureFactory([]).startCapture(options, hooks);
        const stop = s.stop.bind(s);
        s.stop = async () => {
          const r = await stop();
          return {
            ...r,
            tracks: [{ track: "screen", mimeType: "video/mp4;codecs=avc1", chunkCount: 1 }],
          };
        };
        return s;
      },
    });
    await recorded(u);
    expect(u.port.transcodeListeners.size).toBe(0);
  });

  it("delete and dispose stop watching", async () => {
    const t = harness();
    await recorded(t);
    await t.flow.deleteRecording();
    expect(t.port.transcodeListeners.size).toBe(0);
    t.port.emitTranscode(done("/rec/s1/screen.h264.mp4"));
    await drain();
    expect(t.projects.relinked).toEqual([]);

    const u = harness();
    await recorded(u);
    u.flow.dispose();
    expect(u.port.transcodeListeners.size).toBe(0);
  });
});
