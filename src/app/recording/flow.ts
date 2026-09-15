import { type StoreApi, createStore } from "zustand/vanilla";
import { type ProjectV1, loadProject } from "../../editor/model/v1";
import type { CaptureDeps, CaptureOptions, CaptureSession } from "../../recording/captureSession";
import type { Platform } from "../../recording/constraints";
import {
  type RecordingError,
  type RecordingEvent,
  type TrackKind,
  toRecordingError,
} from "../../recording/port";
import { captureWarningCode, interruptCopy } from "../../recording/sessionStore";
import { useAppSettings } from "../settings/store";
import type { RecordingBus, SessionSnapshot, SnapshotPhase } from "./bus";
import {
  type CaptureOptionsResult,
  type RecordingDocumentDefaults,
  type RecordingSetup,
  buildRecordingDocument,
  captureOptionsFor,
  displayIdFor,
  micLabelFor,
  planMedia,
  recordingProjectName,
  resolvedFileNames,
  sourceLabel,
  toStartRequest,
  webcamCaptureOptionsFor,
} from "./document";
import type {
  AppRecordingPort,
  FinalizeResult,
  ProjectPort,
  SourcesResult,
  SystemPort,
  TranscodeProgressEvent,
  WindowsPort,
} from "./port";

/**
 * Launcher-hosted recording flow (SPEC §5.6, guide S04–S11):
 *
 *   idle ─start→ starting ─recording:start→ countdown ─started→ recording ⇄ paused
 *     ↑                                                           │ stopped / interrupted
 *     └──── recordAnother / delete ── done ← creatingProject ← finalizing
 *
 * - Subscribes to `recording:event` *before* `recording:start` and buffers
 *   events until the session id is known (main emits the first countdown
 *   tick before the start reply arrives).
 * - Electron backend: starts the renderer capture on `started`, mirrors main's
 *   pause/resume onto the MediaRecorders, and on stop/interrupt flushes every
 *   chunk + ends each track *before* `recording:finalize` — so an interrupted
 *   recording keeps everything written.
 * - Native backends (sck/wgc): the helper records screen + audio; with the
 *   webcam on, a webcam-only renderer capture streams beside it (§5.7). Its
 *   failure is a warning, never the end of the screen recording.
 * - Mic mute (HUD `hud:setMicMuted`): the renderer disables its mic track on the
 *   Electron backend; native backends go through `recording:setMicMuted`.
 * - Restart (HUD `hud:restart`): discard the live session keeping the HUD open,
 *   then start again with the same setup (region mode re-opens the selection).
 * - The mic's device label is resolved at start (native helpers match by label).
 * - Finalized media is moved into a new project (`project:create`), then the
 *   editor opens or the post-record card (S11) is shown.
 * - Electron-backend videos are transcoded to H.264 in the background (§5.2);
 *   when main reports the finished file, the project's screen video is relinked
 *   to it (`project:relink`, copy) and the document saved. Best effort: a
 *   failure is logged and the project keeps the recorded VP9.
 * - Other windows (HUD, countdown, overlays) learn the session over the bus.
 */

export type FlowPhase =
  | "idle"
  | "selectingRegion"
  | "starting"
  | "countdown"
  | "recording"
  | "paused"
  | "finalizing"
  | "creatingProject"
  | "done"
  | "error";

export type FlowStage =
  | "start"
  | "capture"
  | "finalize"
  | "create"
  | "openEditor"
  | "reveal"
  | "delete";

export interface FlowError extends RecordingError {
  stage: FlowStage;
}

export interface InterruptInfo {
  reason: string;
  message: string;
  elapsedMs: number;
}

export interface PostRecordInfo {
  projectId: string;
  projectPath: string;
  name: string;
  durationMs: number;
  interrupted: InterruptInfo | null;
  openedEditor: boolean;
}

export interface RecordingFlowState {
  phase: FlowPhase;
  setup: RecordingSetup | null;
  sessionId: string | null;
  backend: string | null;
  backendReasons: string[];
  countdownRemaining: number | null;
  elapsedMs: number;
  /** Capture warning codes (see `warningCopy`), deduplicated. */
  warnings: string[];
  interrupted: InterruptInfo | null;
  error: FlowError | null;
  result: PostRecordInfo | null;
}

/** Hooks the flow passes to the renderer capture (bound to the real browser deps by the app). */
export type CaptureHooks = Pick<CaptureDeps, "port" | "onMicLevel" | "onDeviceLost" | "onError">;
export interface DeviceInfoLike {
  deviceId: string;
  kind: string;
  label: string;
}

export type StartCaptureFn = (
  options: CaptureOptions,
  hooks: CaptureHooks,
) => Promise<CaptureSession>;

export interface RecordingFlowDeps {
  port: AppRecordingPort;
  windows: WindowsPort;
  projects: ProjectPort;
  system: SystemPort;
  startCapture: StartCaptureFn;
  platform: Platform;
  appVersion: string;
  newId(): string;
  nowIso(): string;
  /** Settings "Open editor automatically after recording". */
  openEditorAfterRecording(): boolean;
  /** Latest `recording:listSources` the launcher shows; fetched when null. */
  sources(): SourcesResult | null;
  bus?: RecordingBus | undefined;
  /** `navigator.mediaDevices.enumerateDevices` (mic label for native helpers). */
  enumerateDevices?: (() => Promise<readonly DeviceInfoLike[]>) | undefined;
  /** Settings "Default frame preset" / "Default aspect"; defaults to the app settings store. */
  editorDefaults?: (() => RecordingDocumentDefaults) | undefined;
  /** Best-effort failures (transcode relink); defaults to `console.warn`. */
  log?: ((message: string) => void) | undefined;
}

/** Read-only view of the app settings used for new recording documents (§11). */
export function appEditorDefaults(): RecordingDocumentDefaults {
  const { defaultFramePreset, defaultAspect } = useAppSettings.getState().settings;
  return { framePreset: defaultFramePreset, aspect: defaultAspect };
}

const browserEnumerateDevices = async (): Promise<readonly DeviceInfoLike[]> =>
  typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices
    ? navigator.mediaDevices.enumerateDevices()
    : [];

/** A finished background transcode waiting for (or applied to) its project. */
interface TranscodeWatch {
  recordingId: string;
  durationMs: number;
  done: TranscodeProgressEvent | null;
  target: { projectPath: string; document: ProjectV1 } | null;
  off: () => void;
}

export interface RecordingFlow {
  store: StoreApi<RecordingFlowState>;
  /** Region mode: open overlays and wait for a selection on the bus. */
  selectRegion(setup: RecordingSetup): Promise<void>;
  cancelRegionSelection(): Promise<void>;
  start(setup: RecordingSetup): Promise<void>;
  /** Discard the live session (countdown / recording). */
  cancel(): Promise<void>;
  /** Retry the failed stage (finalize / create / open editor); start failures return to idle. */
  retry(): Promise<void>;
  openInEditor(): Promise<void>;
  reveal(): Promise<void>;
  recordAnother(): Promise<void>;
  deleteRecording(): Promise<void>;
  dismissError(): void;
  /** Mute / unmute the mic of the live session (applied once capture starts). */
  setMicMuted(muted: boolean): Promise<void>;
  dispose(): void;
}

export function initialFlowState(): RecordingFlowState {
  return {
    phase: "idle",
    setup: null,
    sessionId: null,
    backend: null,
    backendReasons: [],
    countdownRemaining: null,
    elapsedMs: 0,
    warnings: [],
    interrupted: null,
    error: null,
    result: null,
  };
}

const LIVE_PHASES: readonly FlowPhase[] = ["starting", "countdown", "recording", "paused"];

export function createRecordingFlow(deps: RecordingFlowDeps): RecordingFlow {
  const store = createStore<RecordingFlowState>(() => initialFlowState());
  const get = store.getState;
  const set = (patch: Partial<RecordingFlowState>): void => store.setState(patch);

  let unsubscribeEvents: (() => void) | null = null;
  let unsubscribeRegion: (() => void) | null = null;
  let capturePromise: Promise<CaptureSession | null> | null = null;
  let mimeTypes: Partial<Record<TrackKind, string>> = {};
  let finalized: FinalizeResult | null = null;
  let finalizing: Promise<void> | null = null;
  let sourcesAtStart: SourcesResult | null = null;
  let countdownTotal: number | null = null;
  let regionDisplays: string[] = [];
  let disposed = false;
  let micMuted = false;

  const fail = (stage: FlowStage, err: unknown, fallback = "recording-failed"): void => {
    set({ phase: "error", error: { ...toRecordingError(err, fallback), stage } });
  };

  const quietly = (p: Promise<unknown>): void => {
    p.catch(() => {});
  };

  const addWarning = (code: string): void => {
    const { warnings, sessionId } = get();
    if (!warnings.includes(code)) set({ warnings: [...warnings, code] });
    if (sessionId) deps.bus?.post({ type: "warning", sessionId, code });
  };

  // ---- bus snapshot -----------------------------------------------------------

  const snapshot = (): SessionSnapshot | null => {
    const s = get();
    const phase = s.phase;
    const live: SnapshotPhase | null =
      phase === "selectingRegion" ||
      phase === "starting" ||
      phase === "countdown" ||
      phase === "recording" ||
      phase === "paused" ||
      phase === "finalizing"
        ? phase
        : phase === "creatingProject"
          ? "finalizing"
          : null;
    if (!live || !s.setup) return null;
    return {
      sessionId: s.sessionId,
      phase: live,
      countdownRemaining: s.countdownRemaining,
      countdownTotal,
      sourceLabel: sourceLabel(s.setup, sourcesAtStart),
      displayId: displayIdFor(s.setup, sourcesAtStart) ?? null,
      webcamDeviceId: s.setup.webcam ? (s.setup.webcamDeviceId ?? "") : null,
      setup: s.setup,
    };
  };

  let lastSnapshotJson = "";
  const publish = (): void => {
    const snap = snapshot();
    const json = JSON.stringify(snap);
    if (json === lastSnapshotJson) return;
    lastSnapshotJson = json;
    deps.bus?.post({ type: "snapshot", snapshot: snap });
  };
  const unsubscribeStore = store.subscribe(publish);
  const unsubscribeBus = deps.bus?.subscribe((m) => {
    if (m.type === "snapshotRequest") deps.bus?.post({ type: "snapshot", snapshot: snapshot() });
    // Pre-record HUD (guide S05): same entry points as the launcher's Record.
    else if (m.type === "startRequest") startWith(m.setup);
    else if (m.type === "hud:setMicMuted") void setMicMuted(m.muted);
    else if (m.type === "hud:restart") void restart();
  });

  const startWith = (setup: RecordingSetup): void => {
    if (setup.mode === "region") void selectRegion(setup);
    else void start(setup);
  };

  // ---- windows ------------------------------------------------------------------

  const closeSessionWindows = (): void => {
    for (const kind of ["countdown", "webcam-bubble", "hud"] as const) {
      quietly(deps.windows.closeKind(kind));
    }
  };

  /** Setup to start again once main confirms the discard of a HUD Restart. */
  let restartSetup: RecordingSetup | null = null;

  const stopListening = (): void => {
    unsubscribeEvents?.();
    unsubscribeEvents = null;
  };

  const resetSession = (): void => {
    stopListening();
    capturePromise = null;
    mimeTypes = {};
    finalized = null;
    finalizing = null;
    countdownTotal = null;
    micMuted = false;
    restartSetup = null;
  };

  // ---- renderer capture ----------------------------------------------------------

  /**
   * Start the renderer capture: every track on the Electron backend (a failure
   * discards the session), or only the webcam beside a native helper (a failure
   * is a warning; the helper keeps recording).
   */
  const beginCapture = (sessionId: string, opts: CaptureOptionsResult, native: boolean): void => {
    const giveUp = async (err: unknown, fallback: string): Promise<void> => {
      if (native) {
        if (get().sessionId === sessionId)
          addWarning(captureWarningCode(toRecordingError(err, fallback).code));
        return;
      }
      fail("capture", err, fallback);
      await deps.port.discard(sessionId).catch(() => {});
      closeSessionWindows();
      stopListening();
    };
    capturePromise = (async () => {
      if (!opts.ok) {
        await giveUp({ code: opts.code, message: opts.message }, "capture-failed");
        return null;
      }
      // Late callbacks from a discarded/finished capture (e.g. a chunk write
      // refused after discard) must not leak into the next session's state.
      const current = (): boolean => get().sessionId === sessionId;
      try {
        const capture = await deps.startCapture(opts.options, {
          port: deps.port,
          onMicLevel: (level) => {
            if (current()) deps.bus?.post({ type: "micLevel", sessionId, level });
          },
          onDeviceLost: () => {
            if (current()) addWarning("deviceLost");
          },
          onError: (e) => {
            if (current()) addWarning(captureWarningCode(e.code));
          },
        });
        for (const w of capture.warnings) addWarning(w);
        mimeTypes = {};
        if (micMuted) capture.setMicMuted?.(true);
        return capture;
      } catch (err) {
        if (get().sessionId === sessionId && LIVE_PHASES.includes(get().phase)) {
          await giveUp(err, "capture-failed");
        }
        return null;
      }
    })();
    void capturePromise.then((capture) => {
      // Stopped / discarded while the streams were being acquired.
      if (!capture) return;
      const phase = get().phase;
      if (phase === "paused") capture.pause();
      if (phase === "idle" || phase === "error") quietly(capture.discard());
    });
  };

  /** Resolve the mic's device label once, without blocking a start on failure. */
  const withMicLabel = async (setup: RecordingSetup): Promise<RecordingSetup> => {
    if (!setup.mic || setup.micLabel) return setup;
    try {
      const devices = await (deps.enumerateDevices ?? browserEnumerateDevices)();
      const micLabel = micLabelFor(setup, devices);
      return micLabel ? { ...setup, micLabel } : setup;
    } catch {
      return setup; // Main falls back to the default input.
    }
  };

  const setMicMuted = async (muted: boolean): Promise<void> => {
    micMuted = muted;
    const { sessionId, backend, phase } = get();
    if (!sessionId || (phase !== "recording" && phase !== "paused")) return;
    if (backend === "electron") {
      const capture = capturePromise ? await capturePromise : null;
      capture?.setMicMuted?.(muted);
      return;
    }
    try {
      await deps.port.setMicMuted?.(sessionId, muted);
    } catch (err) {
      if (get().sessionId === sessionId) addWarning(captureWarningCode(toRecordingError(err).code));
    }
  };

  // ---- background transcode → relink ----------------------------------------------

  const log = deps.log ?? ((message: string) => console.warn(message));
  const transcodeWatches = new Map<string, TranscodeWatch>();

  const endTranscodeWatch = (w: TranscodeWatch): void => {
    w.off();
    transcodeWatches.delete(w.recordingId);
  };

  const relinkTranscoded = async (w: TranscodeWatch): Promise<void> => {
    const { done, target } = w;
    if (!done?.outputPath || !target || !deps.projects.relink) return;
    endTranscodeWatch(w);
    try {
      const res = await deps.projects.relink({
        path: target.projectPath,
        filePath: done.outputPath,
        expected: { durationMs: w.durationMs },
        mode: "copy",
      });
      // The editor may have saved edits since create: patch the document as saved now.
      const doc = deps.projects.open
        ? loadProject((await deps.projects.open({ path: target.projectPath })).document)
        : target.document;
      if (doc.sources.video.path !== target.document.sources.video.path) {
        log(`transcode relink skipped for ${target.projectPath}: the screen video was replaced`);
        return;
      }
      // The relink reply carries no codec; the transcode always writes H.264.
      const document: ProjectV1 = {
        ...doc,
        sources: { ...doc.sources, video: { ...doc.sources.video, path: res.path, codec: "h264" } },
      };
      await deps.projects.save({ path: target.projectPath, document });
    } catch (err) {
      const e = toRecordingError(err, "RELINK_FAILED");
      log(`transcode relink failed for ${target.projectPath}: ${e.code} ${e.message}`);
    }
  };

  /** Watch the background transcode of a finalized Electron-backend video. */
  const watchTranscode = (fin: FinalizeResult): void => {
    if (!deps.port.onTranscodeProgress || !deps.projects.relink) return;
    if (fin.meta.backend !== "electron") return;
    if (transcodeWatches.has(fin.recordingId) || disposed) return;
    const w: TranscodeWatch = {
      recordingId: fin.recordingId,
      durationMs: fin.meta.durationMs,
      done: null,
      target: null,
      off: () => {},
    };
    transcodeWatches.set(fin.recordingId, w);
    w.off = deps.port.onTranscodeProgress((p) => {
      if (p.sessionId !== w.recordingId || !p.done || w.done) return;
      if (!p.outputPath || p.error !== undefined) {
        if (p.error !== undefined) log(`transcode failed for ${w.recordingId}: ${p.error}`);
        endTranscodeWatch(w);
        return;
      }
      w.done = p;
      void relinkTranscoded(w);
    });
  };

  /** The project now owns the video: relink once (or as soon as) the transcode is done. */
  const attachTranscodeTarget = (recordingId: string, projectPath: string, document: ProjectV1) => {
    const w = transcodeWatches.get(recordingId);
    if (!w) return;
    if (document.sources.video.codec === "h264") {
      endTranscodeWatch(w); // Already H.264: main transcodes nothing.
      return;
    }
    w.target = { projectPath, document };
    void relinkTranscoded(w);
  };

  const cancelTranscodeFor = (projectPath: string): void => {
    for (const w of [...transcodeWatches.values()]) {
      if (w.target?.projectPath === projectPath) endTranscodeWatch(w);
    }
  };

  // ---- finalize → project --------------------------------------------------------

  const createProject = async (fin: FinalizeResult): Promise<void> => {
    set({ phase: "creatingProject", error: null });
    const id = deps.newId();
    const nowIso = deps.nowIso();
    const name = recordingProjectName(nowIso);
    const plan = planMedia(fin);
    const build = (fileNames: typeof plan.fileNames) =>
      buildRecordingDocument({
        fin,
        sources: sourcesAtStart,
        mimeTypes,
        fileNames,
        id,
        name,
        nowIso,
        appVersion: deps.appVersion,
        defaults,
      });
    let defaults: RecordingDocumentDefaults | undefined;
    try {
      defaults = (deps.editorDefaults ?? appEditorDefaults)();
    } catch {
      defaults = undefined; // Settings not loaded: the default frame.
    }
    let path: string;
    let document: ProjectV1;
    try {
      document = build(plan.fileNames);
      const res = await deps.projects.create({ name, document, media: plan.imports });
      path = res.path;
      const actual = resolvedFileNames(plan, res.mediaFiles);
      if (JSON.stringify(actual) !== JSON.stringify(plan.fileNames)) {
        document = build(actual);
        await deps.projects.save({ path, document });
      }
    } catch (err) {
      fail("create", err, "PROJECT_CREATE_FAILED");
      return;
    }
    attachTranscodeTarget(fin.recordingId, path, document);
    const result: PostRecordInfo = {
      projectId: id,
      projectPath: path,
      name,
      durationMs: fin.meta.durationMs,
      interrupted: get().interrupted,
      openedEditor: false,
    };
    finalized = null;
    stopListening();
    quietly(deps.windows.closeKind("hud"));
    set({ phase: "done", result, sessionId: null });
    if (deps.openEditorAfterRecording() && !result.interrupted) await openEditor();
  };

  const openEditor = async (): Promise<void> => {
    const result = get().result;
    if (!result) return;
    try {
      await deps.windows.openEditor(result.projectId);
      set({ result: { ...result, openedEditor: true }, error: null, phase: "done" });
    } catch (err) {
      set({ error: { ...toRecordingError(err, "OPEN_EDITOR_FAILED"), stage: "openEditor" } });
    }
  };

  const runFinalize = async (sessionId: string): Promise<void> => {
    set({ phase: "finalizing", error: null });
    quietly(deps.windows.closeKind("webcam-bubble"));
    quietly(deps.windows.closeKind("countdown"));
    const capture = capturePromise ? await capturePromise : null;
    if (capture && (capture.state === "recording" || capture.state === "paused")) {
      try {
        const stopped = await capture.stop();
        for (const t of stopped.tracks) mimeTypes[t.track] = t.mimeType;
        for (const e of stopped.errors) addWarning(captureWarningCode(e.error.code));
      } catch (err) {
        addWarning(captureWarningCode(toRecordingError(err).code));
      }
    }
    let fin: FinalizeResult;
    try {
      fin = await deps.port.finalize(sessionId);
    } catch (err) {
      fail("finalize", err, "FINALIZE_FAILED");
      return;
    }
    finalized = fin;
    watchTranscode(fin);
    await createProject(fin);
  };

  const finalize = (sessionId: string): Promise<void> => {
    finalizing ??= runFinalize(sessionId).finally(() => {
      finalizing = null;
    });
    return finalizing;
  };

  // ---- main events ---------------------------------------------------------------

  const onEvent = (e: RecordingEvent): void => {
    const s = get();
    if (e.sessionId !== s.sessionId || !s.setup) return;
    switch (e.type) {
      case "countdown":
        countdownTotal = Math.max(countdownTotal ?? 0, e.remaining);
        if (s.phase === "starting" || s.phase === "countdown")
          set({ phase: "countdown", countdownRemaining: e.remaining });
        return;
      case "started":
        if (s.phase !== "starting" && s.phase !== "countdown") return;
        quietly(deps.windows.closeKind("countdown"));
        set({ phase: "recording", backend: e.backend, countdownRemaining: null });
        if (e.backend === "electron") {
          beginCapture(
            e.sessionId,
            captureOptionsFor(e.sessionId, s.setup, sourcesAtStart, deps.platform),
            false,
          );
        } else {
          const webcam = webcamCaptureOptionsFor(e.sessionId, s.setup, deps.platform);
          if (webcam) beginCapture(e.sessionId, { ok: true, options: webcam }, true);
          if (micMuted) void setMicMuted(true);
        }
        return;
      case "paused":
        if (s.phase === "recording") set({ phase: "paused" });
        set({ elapsedMs: e.elapsedMs });
        void capturePromise?.then((c) => c?.pause());
        return;
      case "resumed":
        if (s.phase === "paused") set({ phase: "recording" });
        set({ elapsedMs: e.elapsedMs });
        void capturePromise?.then((c) => c?.resume());
        return;
      case "stats":
        set({ elapsedMs: e.elapsedMs });
        return;
      case "stopped":
        set({ elapsedMs: e.elapsedMs });
        if (e.reason === "maxLength") addWarning("maxLength");
        void finalize(e.sessionId);
        return;
      case "interrupted":
        set({
          elapsedMs: e.elapsedMs,
          interrupted: {
            reason: e.reason,
            message: e.message ?? interruptCopy(e.reason),
            elapsedMs: e.elapsedMs,
          },
        });
        if (s.phase !== "finalizing" && s.phase !== "creatingProject") void finalize(e.sessionId);
        return;
      case "diskLow":
        addWarning("diskLow");
        return;
      case "deviceLost":
        addWarning("deviceLost");
        return;
      case "discarded": {
        const cp = capturePromise;
        if (cp) void cp.then((c) => c?.discard());
        const again = restartSetup;
        if (again) {
          // HUD Restart: the pill stays open and adopts the next session.
          quietly(deps.windows.closeKind("countdown"));
          quietly(deps.windows.closeKind("webcam-bubble"));
        } else {
          closeSessionWindows();
        }
        resetSession();
        store.setState(initialFlowState());
        if (again) startWith(again);
        return;
      }
      case "error": {
        const cp = capturePromise;
        if (cp) void cp.then((c) => c?.discard());
        closeSessionWindows();
        resetSession();
        set({ phase: "error", error: { code: e.code, message: e.message, stage: "start" } });
        return;
      }
    }
  };

  // ---- actions ----------------------------------------------------------------------

  const canStart = (): boolean => {
    const phase = get().phase;
    return phase === "idle" || phase === "error" || phase === "done" || phase === "selectingRegion";
  };

  const start = async (requested: RecordingSetup): Promise<void> => {
    let setup = requested;
    if (disposed || !canStart()) return;
    resetSession();
    store.setState({ ...initialFlowState(), phase: "starting", setup });

    const labelled = await withMicLabel(setup);
    if (get().phase !== "starting") return;
    if (labelled !== setup) set({ setup: labelled });
    setup = labelled;

    sourcesAtStart = deps.sources();
    if (!sourcesAtStart) {
      try {
        sourcesAtStart = await deps.port.listSources();
      } catch {
        sourcesAtStart = null; // main re-validates the source; labels fall back.
      }
    }

    const buffered: RecordingEvent[] = [];
    let known: string | null = null;
    unsubscribeEvents = deps.port.subscribe((e) => {
      if (known === null) buffered.push(e);
      else if (e.sessionId === known) onEvent(e);
    });

    let res: Awaited<ReturnType<AppRecordingPort["start"]>>;
    try {
      res = await deps.port.start(toStartRequest(setup));
    } catch (err) {
      stopListening();
      fail("start", err, "START_FAILED");
      return;
    }
    known = res.sessionId;
    set({ sessionId: res.sessionId, backend: res.backend, backendReasons: res.backendReasons });

    const displayId = displayIdFor(setup, sourcesAtStart);
    quietly(deps.windows.openHud(displayId));
    if (setup.countdown > 0) {
      countdownTotal = setup.countdown;
      set({ phase: "countdown", countdownRemaining: setup.countdown });
      quietly(deps.windows.openCountdown(displayId));
    }
    if (setup.webcam) quietly(deps.windows.openWebcamBubble());
    for (const e of buffered.splice(0)) if (e.sessionId === known) onEvent(e);
  };

  const closeRegionOverlays = async (): Promise<void> => {
    unsubscribeRegion?.();
    unsubscribeRegion = null;
    for (const id of regionDisplays) quietly(deps.windows.setRegionSelecting(id, false));
    regionDisplays = [];
    await deps.windows.closeKind("region-overlay").catch(() => {});
  };

  const selectRegion = async (setup: RecordingSetup): Promise<void> => {
    if (disposed || !canStart()) return;
    resetSession();
    store.setState({ ...initialFlowState(), phase: "selectingRegion", setup });
    if (!deps.bus) {
      fail("start", {
        code: "REGION_UNAVAILABLE",
        message: "Region selection needs the overlay bus",
      });
      return;
    }
    unsubscribeRegion?.();
    unsubscribeRegion = deps.bus.subscribe((m) => {
      if (get().phase !== "selectingRegion") return;
      if (m.type === "regionSelected") {
        const current = get().setup ?? setup;
        void closeRegionOverlays().then(() =>
          start({ ...current, mode: "region", sourceId: m.displayId, region: m.region }),
        );
      } else if (m.type === "regionCancelled") {
        void closeRegionOverlays().then(() => store.setState(initialFlowState()));
      }
    });
    try {
      regionDisplays = await deps.windows.openRegionOverlays();
      for (const id of regionDisplays) quietly(deps.windows.setRegionSelecting(id, true));
    } catch (err) {
      await closeRegionOverlays();
      fail("start", err, "REGION_UNAVAILABLE");
    }
  };

  const cancel = async (): Promise<void> => {
    const { sessionId, phase } = get();
    if (!sessionId || !LIVE_PHASES.includes(phase)) return;
    try {
      await deps.port.discard(sessionId);
    } catch (err) {
      set({ error: { ...toRecordingError(err), stage: "start" } });
    }
  };

  /** HUD Restart: discard the live session (HUD kept), then start the same setup again. */
  const restart = async (): Promise<void> => {
    const { sessionId, phase, setup } = get();
    if (disposed || !sessionId || !setup || !LIVE_PHASES.includes(phase) || restartSetup) return;
    restartSetup = setup;
    try {
      await deps.port.discard(sessionId);
    } catch (err) {
      if (get().sessionId !== sessionId) return;
      restartSetup = null;
      set({ error: { ...toRecordingError(err), stage: "start" } });
    }
  };

  const retry = async (): Promise<void> => {
    const { error, sessionId } = get();
    if (!error) return;
    switch (error.stage) {
      case "finalize":
        if (sessionId) await finalize(sessionId);
        return;
      case "create":
        if (finalized) await createProject(finalized);
        return;
      case "openEditor":
        await openEditor();
        return;
      default:
        resetSession();
        store.setState(initialFlowState());
    }
  };

  return {
    store,
    selectRegion,
    cancelRegionSelection: async () => {
      if (get().phase !== "selectingRegion") return;
      await closeRegionOverlays();
      store.setState(initialFlowState());
    },
    start,
    cancel,
    retry,
    openInEditor: openEditor,
    reveal: async () => {
      const result = get().result;
      if (!result) return;
      try {
        await deps.system.reveal(result.projectPath);
      } catch (err) {
        set({ error: { ...toRecordingError(err, "REVEAL_FAILED"), stage: "reveal" } });
      }
    },
    recordAnother: async () => {
      if (get().phase !== "done" && get().phase !== "error") return;
      resetSession();
      store.setState(initialFlowState());
    },
    deleteRecording: async () => {
      const result = get().result;
      if (!result) return;
      try {
        await deps.system.deleteProject(result.projectPath);
        cancelTranscodeFor(result.projectPath);
        resetSession();
        store.setState(initialFlowState());
      } catch (err) {
        set({ error: { ...toRecordingError(err, "DELETE_FAILED"), stage: "delete" } });
      }
    },
    setMicMuted,
    dismissError: () => {
      const { phase, result } = get();
      if (phase === "error" && !finalized && !result) {
        resetSession();
        store.setState(initialFlowState());
      } else {
        set({ error: null });
      }
    },
    dispose: () => {
      disposed = true;
      stopListening();
      unsubscribeRegion?.();
      unsubscribeStore();
      unsubscribeBus?.();
      for (const w of [...transcodeWatches.values()]) endTranscodeWatch(w);
    },
  };
}
