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
  HudExpansionPlan,
  HudExpansionSize,
  HudLayoutInfo,
  HudRect,
  HudSizeRequest,
  HudWindowPlan,
  HudWindowsPort,
  OpenProjectRequest,
  OpenProjectResult,
  ProjectPort,
  RelinkProjectRequest,
  RelinkProjectResult,
  SaveProjectRequest,
  SourcesResult,
  StartRecordingRequest,
  StartRecordingResult,
  SystemPort,
  TranscodeProgressEvent,
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
  transcodeListeners = new Set<(p: TranscodeProgressEvent) => void>();
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
  onTranscodeProgress(listener: (p: TranscodeProgressEvent) => void): () => void {
    this.transcodeListeners.add(listener);
    return () => this.transcodeListeners.delete(listener);
  }
  emitTranscode(p: TranscodeProgressEvent): void {
    for (const l of [...this.transcodeListeners]) l(p);
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
  relinked: RelinkProjectRequest[] = [];
  relinkError: Failure | null = null;
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
  async open(req: OpenProjectRequest): Promise<OpenProjectResult> {
    const doc =
      this.saved.findLast((s) => s.path === req.path)?.document ??
      this.created.findLast((c) => `/Projects/${c.name}.reelform` === req.path)?.document;
    if (doc === undefined) throw { code: "PROJECT_NOT_FOUND", message: req.path };
    return { path: req.path, document: doc, modifiedAt: null, recovery: null };
  }
  async relink(req: RelinkProjectRequest): Promise<RelinkProjectResult> {
    this.relinked.push(req);
    if (this.relinkError) throw this.relinkError;
    const name = req.filePath.split(/[\\/]/).at(-1) ?? "video";
    return {
      path: req.mode === "reference" ? req.filePath : `media/${name}`,
      probe: { durationMs: req.expected.durationMs, width: 3024, height: 1964 },
    };
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
  /** Prepares and other requests, e.g. `expand:560x104`, `collapse`, `size:300x48:center`. */
  calls: string[] = [];
  /** Commit ids in the order the renderer committed them. */
  commits: number[] = [];
  /** Current window bounds (moves only on commit). */
  bounds: HudRect = { x: 440, y: 836, width: 560, height: 64 };
  /** The pill inside the window (screen coordinates). */
  pill: HudRect = { x: 440, y: 836, width: 560, height: 64 };
  /** False simulates "no HUD open" (every prepare resolves null). */
  hudOpen = true;
  private seq = 0;
  private pending: { commitId: number; target: HudRect; pill: HudRect } | null = null;

  /** Layout for a non-null expansion: grows upward, centred on the pill. */
  layoutFor: (size: HudExpansionSize) => HudLayoutInfo = (size) => {
    const pillOffset = { x: (size.width - this.pill.width) / 2, y: size.height - this.pill.height };
    return {
      bounds: { x: this.pill.x - pillOffset.x, y: this.pill.y - pillOffset.y, ...size },
      placement: "above",
      pillOffset,
    };
  };

  private prepare(target: HudRect, pill: HudRect) {
    const commitId = ++this.seq;
    this.pending = { commitId, target, pill };
    return { commitId, previous: { ...this.bounds }, target: { ...target } };
  }

  async setHudExpansion(size: HudExpansionSize | null): Promise<HudExpansionPlan | null> {
    this.calls.push(size ? `expand:${size.width}x${size.height}` : "collapse");
    if (!this.hudOpen) return null;
    const layout = size ? this.layoutFor(size) : null;
    return { ...this.prepare(layout ? layout.bounds : { ...this.pill }, { ...this.pill }), layout };
  }
  async setHudSize(req: HudSizeRequest): Promise<HudWindowPlan | null> {
    this.calls.push(`size:${req.width}x${req.height}:${req.anchor}`);
    if (!this.hudOpen) return null;
    const p = this.pill;
    const target =
      req.anchor === "center"
        ? {
            x: p.x + (p.width - req.width) / 2,
            y: p.y + (p.height - req.height) / 2,
            width: req.width,
            height: req.height,
          }
        : { x: p.x, y: p.y, width: req.width, height: req.height };
    return this.prepare(target, { ...target });
  }
  async commitHudLayout(commitId: number): Promise<boolean> {
    this.commits.push(commitId);
    const p = this.pending;
    if (!p || p.commitId !== commitId) return false;
    this.pending = null;
    this.bounds = p.target;
    this.pill = p.pill;
    return true;
  }
  async openSourceOutline(displayId: string) {
    this.calls.push(`openSourceOutline:${displayId}`);
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
    frames: async () => {},
    onResize: () => () => {},
    ...overrides,
  };
  return { deps, log, state, windows, timers };
}
