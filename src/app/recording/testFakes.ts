import type {
  CaptureOptions,
  CaptureSession,
  CaptureState,
  StopResult,
} from "../../recording/captureSession";
import type {
  EndTrackRequest,
  RecordingEvent,
  TrackKind,
  WriteChunkRequest,
} from "../../recording/port";
import type { DeviceLike } from "./LauncherContainer";
import type { HudTimers, MicLevelHandlers, PreRecordDeps } from "./PreRecordContainer";
import type { CaptureHooks } from "./flow";
import type {
  AppRecordingPort,
  ClosableWindowKind,
  CreateProjectRequest,
  CreateProjectResult,
  FinalizeResult,
  HudExpansionSize,
  HudLayoutInfo,
  HudWindowsPort,
  ProjectPort,
  SaveProjectRequest,
  SourcesResult,
  StartRecordingRequest,
  StartRecordingResult,
  SystemPort,
  WindowsPort,
} from "./port";

/** Test doubles for the recording flow and containers (imported by tests only). */

export const SOURCES: SourcesResult = {
  backend: "electron",
  displays: [
    {
      id: "d1",
      name: "Studio Display",
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
      mediaSourceId: "screen:1:0",
    },
    {
      id: "d2",
      name: "LG UltraFine",
      bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      mediaSourceId: "screen:2:0",
    },
  ],
  windows: [
    {
      id: "window:42:0",
      title: "Onboarding.fig",
      appName: "Figma",
      bounds: { x: 100, y: 100, width: 1280, height: 720 },
      displayId: "d1",
    },
  ],
};

export function finalizeFixture(overrides: Partial<FinalizeResult["meta"]> = {}): FinalizeResult {
  return {
    recordingId: "s1",
    dir: "/rec/s1",
    video: { path: "/rec/s1/screen.webm", bytes: 1000 },
    mic: { path: "/rec/s1/mic.webm", bytes: 10 },
    telemetry: {
      path: "/rec/s1/telemetry.json.gz",
      pointCount: 12,
      hasClicks: false,
      hasKeys: false,
      sampleHz: 120,
    },
    meta: {
      backend: "electron",
      backendReasons: [],
      os: "darwin 25.5",
      appVersion: "1.0.0",
      createdAt: "2026-09-15T14:32:05.000Z",
      source: { kind: "display", id: "d1" },
      scaleFactor: 2,
      recordedFps: 60,
      hideCursor: false,
      durationMs: 42_180,
      pausedRanges: [],
      firstFramePtsNs: "1",
      telemetryAligned: true,
      ...overrides,
    },
  };
}

type Failure = { code: string; message: string; details?: unknown };

export async function drain(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

export class FakeAppPort implements AppRecordingPort {
  calls: string[] = [];
  writes: WriteChunkRequest[] = [];
  ended: EndTrackRequest[] = [];
  listeners = new Set<(e: RecordingEvent) => void>();
  sources: SourcesResult = SOURCES;
  sourcesError: Failure | null = null;
  startError: Failure | null = null;
  startResult: StartRecordingResult = { sessionId: "s1", backend: "electron", backendReasons: [] };
  /** Events main emits before the start reply arrives. */
  emitBeforeStartReply: RecordingEvent[] = [];
  finalizeErrors: Failure[] = [];
  finalizeResult: FinalizeResult = finalizeFixture();
  discardError: Failure | null = null;
  lastStart: StartRecordingRequest | null = null;

  async listSources(): Promise<SourcesResult> {
    this.calls.push("listSources");
    if (this.sourcesError) throw this.sourcesError;
    return this.sources;
  }
  async start(req: StartRecordingRequest): Promise<StartRecordingResult> {
    this.calls.push("start");
    this.lastStart = req;
    if (this.startError) throw this.startError;
    for (const e of this.emitBeforeStartReply) this.emit(e);
    return this.startResult;
  }
  async finalize(sessionId: string): Promise<FinalizeResult> {
    this.calls.push(`finalize:${sessionId}`);
    const err = this.finalizeErrors.shift();
    if (err) throw err;
    return this.finalizeResult;
  }
  async pause(id: string) {
    this.calls.push(`pause:${id}`);
  }
  async resume(id: string) {
    this.calls.push(`resume:${id}`);
  }
  async stop(id: string) {
    this.calls.push(`stop:${id}`);
  }
  async discard(id: string) {
    this.calls.push(`discard:${id}`);
    if (this.discardError) throw this.discardError;
  }
  async writeChunk(req: WriteChunkRequest) {
    this.writes.push(req);
  }
  async endTrack(req: EndTrackRequest) {
    this.ended.push(req);
  }
  subscribe(listener: (e: RecordingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(e: RecordingEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
}

export class FakeWindows implements WindowsPort {
  calls: string[] = [];
  displayIds = ["d1", "d2"];
  failOn = new Set<string>();

  private record(name: string): Promise<void> {
    this.calls.push(name);
    const key = name.split(":")[0] ?? name;
    return this.failOn.has(key)
      ? Promise.reject({ code: `${key}-failed`, message: `${key} failed` })
      : Promise.resolve();
  }
  openHud(displayId?: string) {
    return this.record(`openHud:${displayId ?? ""}`);
  }
  openCountdown(displayId?: string) {
    return this.record(`openCountdown:${displayId ?? ""}`);
  }
  async openRegionOverlays() {
    await this.record("openRegionOverlays");
    return this.displayIds;
  }
  setRegionSelecting(displayId: string, selecting: boolean) {
    return this.record(`setRegionSelecting:${displayId}:${selecting}`);
  }
  openWebcamBubble() {
    return this.record("openWebcamBubble");
  }
  closeKind(kind: ClosableWindowKind) {
    return this.record(`closeKind:${kind}`);
  }
  openEditor(projectId: string) {
    return this.record(`openEditor:${projectId}`);
  }
}

export class FakeProjects implements ProjectPort {
  created: CreateProjectRequest[] = [];
  saved: SaveProjectRequest[] = [];
  createErrors: Failure[] = [];
  /** Override media names main returns (uniquified on collision). */
  renameMedia: ((name: string) => string) | null = null;

  async create(req: CreateProjectRequest): Promise<CreateProjectResult> {
    this.created.push(req);
    const err = this.createErrors.shift();
    if (err) throw err;
    return {
      path: `/Projects/${req.name}.reelform`,
      document: req.document,
      modifiedAt: "2026-09-15T14:32:06.000Z",
      mediaFiles: (req.media ?? []).map((m) => this.renameMedia?.(m.fileName) ?? m.fileName),
    };
  }
  async save(req: SaveProjectRequest): Promise<void> {
    this.saved.push(req);
  }
}

export class FakeSystem implements SystemPort {
  calls: string[] = [];
  fail: Failure | null = null;
  async reveal(path: string) {
    this.calls.push(`reveal:${path}`);
    if (this.fail) throw this.fail;
  }
  async deleteProject(path: string) {
    this.calls.push(`delete:${path}`);
    if (this.fail) throw this.fail;
  }
  openPermissionSettings = async (kind: string) => {
    this.calls.push(`permissions:${kind}`);
  };
}

export class FakeCapture implements CaptureSession {
  state: CaptureState = "recording";
  warnings: string[] = [];
  tracks: TrackKind[] = ["screen", "mic"];
  constructor(
    readonly log: string[],
    readonly options: CaptureOptions,
    readonly hooks: CaptureHooks,
  ) {}
  timing() {
    return { recorderStartEpochMs: 0, firstDataEpochMs: null, pausedRanges: [] };
  }
  pause() {
    if (this.state !== "recording") return;
    this.state = "paused";
    this.log.push("capture.pause");
  }
  resume() {
    if (this.state !== "paused") return;
    this.state = "recording";
    this.log.push("capture.resume");
  }
  async stop(): Promise<StopResult> {
    this.log.push("capture.stop");
    await drain(5);
    this.state = "stopped";
    return {
      tracks: [
        { track: "screen", mimeType: "video/webm;codecs=vp9", chunkCount: 3 },
        { track: "mic", mimeType: "audio/webm;codecs=opus", chunkCount: 2 },
      ],
      timing: this.timing(),
      errors: [],
    };
  }
  async discard() {
    this.log.push("capture.discard");
    this.state = "discarded";
  }
}

export function fakeCaptureFactory(log: string[]) {
  const sessions: FakeCapture[] = [];
  let failWith: Failure | null = null;
  return {
    sessions,
    fail(err: Failure | null) {
      failWith = err;
    },
    startCapture: async (options: CaptureOptions, hooks: CaptureHooks) => {
      log.push("capture.start");
      if (failWith) throw failWith;
      const s = new FakeCapture(log, options, hooks);
      sessions.push(s);
      return s;
    },
  };
}

// ---- HUD pre-record -----------------------------------------------------------------

export class FakeHudWindows implements HudWindowsPort {
  calls: string[] = [];
  /** Layout returned for a non-null expansion; null simulates "no HUD". */
  layoutFor: (size: HudExpansionSize) => HudLayoutInfo | null = (size) => ({
    bounds: { x: 440 - (size.width - 560) / 2, y: 836 - size.height, ...size },
    placement: "above",
    pillOffset: { x: (size.width - 560) / 2, y: size.height - 64 },
  });
  async setHudExpansion(size: HudExpansionSize | null) {
    this.calls.push(size ? `expand:${size.width}x${size.height}` : "collapse");
    return size ? this.layoutFor(size) : null;
  }
  async openWebcamBubble() {
    this.calls.push("openWebcamBubble");
  }
  async closeKind(kind: ClosableWindowKind) {
    this.calls.push(`closeKind:${kind}`);
  }
  async openSettings() {
    this.calls.push("openSettings");
  }
}

/** Manual interval + timeout timers: `tick()` fires intervals, `runTimeouts()` fires timeouts. */
export function manualHudTimers(): HudTimers & {
  intervals: Map<number, () => void>;
  timeouts: Map<number, () => void>;
  tick(): void;
  runTimeouts(): void;
} {
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  let id = 0;
  return {
    intervals,
    timeouts,
    setInterval: (cb) => {
      intervals.set(++id, cb);
      return id;
    },
    clearInterval: (h) => {
      intervals.delete(h as number);
    },
    setTimeout: (cb) => {
      timeouts.set(++id, cb);
      return id;
    },
    clearTimeout: (h) => {
      timeouts.delete(h as number);
    },
    tick() {
      for (const cb of [...intervals.values()]) cb();
    },
    runTimeouts() {
      const due = [...timeouts.entries()];
      timeouts.clear();
      for (const [, cb] of due) cb();
    },
  };
}

export const HUD_DEVICES: DeviceLike[] = [
  { deviceId: "mic-1", kind: "audioinput", label: "MacBook Pro Microphone" },
  { deviceId: "mic-2", kind: "audioinput", label: "Shure MV7" },
  { deviceId: "cam-1", kind: "videoinput", label: "FaceTime HD Camera" },
];

export function fakePreRecordDeps(overrides: Partial<PreRecordDeps> = {}) {
  const log: string[] = [];
  const state = {
    sources: SOURCES as SourcesResult,
    sourcesError: null as Failure | null,
    devices: HUD_DEVICES,
    micError: null as Failure | null,
    levelHandlers: null as MicLevelHandlers | null,
  };
  const windows = new FakeHudWindows();
  const timers = manualHudTimers();
  const deps: PreRecordDeps = {
    listSources: async () => {
      log.push("listSources");
      if (state.sourcesError) throw state.sourcesError;
      return state.sources;
    },
    enumerateDevices: async () => {
      log.push("enumerateDevices");
      return state.devices;
    },
    openMicLevel: async (deviceId, handlers) => {
      log.push(`mic.open:${deviceId}`);
      if (state.micError) throw state.micError;
      state.levelHandlers = handlers;
      return () => log.push(`mic.stop:${deviceId}`);
    },
    windows,
    platform: "darwin",
    timers,
    ...overrides,
  };
  return { deps, log, state, windows, timers };
}
