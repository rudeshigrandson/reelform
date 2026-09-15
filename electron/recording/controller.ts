import type { z } from "zod";
import { selectBackend } from "../capture/backendSelection";
import type { Timers } from "../capture/helperProcess";
import type {
  BackendId,
  CaptureBackend,
  CaptureEvent,
  InterruptReason,
  Rect,
  Session,
  Sources,
  StartRequest,
  Track,
} from "../capture/types";
import type {
  FinalizeResponse,
  MediaRef,
  RecordingContracts,
  RecordingEvent,
  RecordingMeta,
} from "./contracts";
import {
  type PausedRange,
  canStartWithFreeBytes,
  diskStatus,
  diskWarningBytes,
  effectiveMaxLengthMs,
  maxLengthReached,
  recordedDurationMs,
} from "./rules";
import {
  type RecordingAction,
  type RecordingState,
  canTransition,
  isActive,
  isCapturing,
  transition,
} from "./stateMachine";
import {
  type InputHook,
  TelemetryCollector,
  type TelemetryFile,
  encodeTelemetry,
} from "./telemetry";

/**
 * Recording session controller (ENGINEERING_SPEC §5.6): owns the state machine,
 * the capture backend session, telemetry collection, disk / max-length
 * monitoring, interruption handling and finalize. All side effects injected.
 */

export class RecordingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RecordingError";
  }
}

export interface PermissionResult {
  ok: boolean;
  /** e.g. `["screen", "microphone"]`. */
  missing?: string[] | undefined;
}

export interface RecordingSettings {
  maxLengthMs?: number | null | undefined;
  /** §9.7 "Record typed text badges" — off by default. */
  keepTypedText: boolean;
  backendOverride?: BackendId | null | undefined;
  /**
   * Settings "Warn when free disk space is below" (GB, §11). Below it a running
   * recording emits `diskLow` once; below 500MB it is interrupted. Main-shell:
   * pass `settings.get().diskWarningThresholdGb`. Missing → 2GB.
   */
  diskWarningThresholdGb?: number | undefined;
}

export interface RecordingDeps {
  backends: readonly CaptureBackend[];
  platform: string;
  /** e.g. `macOS 14.5`. */
  os: string;
  appVersion: string;
  settings(): RecordingSettings;
  checkPermissions(req: StartRequest, backend: BackendId): Promise<PermissionResult>;
  freeDiskBytes(dir: string): Promise<number>;
  /** Root folder; each session writes into `<recordingsDir>/<sessionId>/`. */
  recordingsDir: string;
  join(...parts: string[]): string;
  mkdir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Size in bytes, or `null` when the file does not exist. */
  fileSize(path: string): Promise<number | null>;
  gzip(bytes: Uint8Array): Promise<Uint8Array>;
  newId(): string;
  /** Monotonic ms clock for durations/timers. */
  nowMs(): number;
  nowIso(): string;
  /** Host clock the given backend reports `firstFramePtsNs` in (§5.6). */
  hostNowNs(backend: BackendId): bigint;
  timers: Timers;
  emit(event: RecordingEvent): void;
  /** Global input hook (uiohook-like); `null` = no telemetry beyond an empty file. */
  inputHook?: InputHook | null | undefined;
  onDisplayRemoved?: ((listener: (displayId: string) => void) => () => void) | undefined;
  /** Remux / thumbnail / waveform step; may rewrite refs (e.g. screen.webm → screen.mp4). */
  postProcess?: ((res: FinalizeResponse) => Promise<FinalizeResponse>) | undefined;
  /**
   * Write the duration into a MediaRecorder WebM header so the file is seekable
   * even when it is never remuxed (§5.2). Best effort; failures keep the file.
   */
  fixWebmDuration?: ((path: string, durationMs: number) => Promise<void>) | undefined;
  statsIntervalMs?: number | undefined;
}

export type RecordingHandlers = {
  [K in keyof RecordingContracts]: (
    req: z.infer<RecordingContracts[K]["request"]>,
  ) => Promise<z.infer<RecordingContracts[K]["response"]>>;
};

export interface CaptureArea {
  origin: TelemetryFile["origin"];
  bounds: Rect;
  scaleFactor: number;
  displayId: string | null;
}

/**
 * Resolve the captured area in hook coordinates. Region is display-local, in
 * the same units as display bounds. `null` when the source is gone.
 */
export function resolveCaptureArea(sources: Sources, req: StartRequest): CaptureArea | null {
  if (req.source.kind === "display") {
    const id = req.source.id;
    const d = sources.displays.find((x) => x.id === id);
    if (!d) return null;
    if (req.region) {
      const r = req.region;
      return {
        origin: "region",
        bounds: { x: d.bounds.x + r.x, y: d.bounds.y + r.y, width: r.width, height: r.height },
        scaleFactor: d.scaleFactor,
        displayId: d.id,
      };
    }
    return {
      origin: "display",
      bounds: { ...d.bounds },
      scaleFactor: d.scaleFactor,
      displayId: d.id,
    };
  }
  const id = req.source.id;
  const w = sources.windows.find((x) => x.id === id);
  if (!w) return null;
  const d = sources.displays.find((x) => x.id === w.displayId) ?? sources.displays[0];
  if (!w.bounds) {
    // desktopCapturer exposes no window bounds: normalize against the display instead.
    if (!d) return null;
    return {
      origin: "display",
      bounds: { ...d.bounds },
      scaleFactor: d.scaleFactor,
      displayId: d.id,
    };
  }
  return {
    origin: "window",
    bounds: { ...w.bounds },
    scaleFactor: d?.scaleFactor ?? 1,
    displayId: w.displayId ?? null,
  };
}

interface Rec {
  id: string;
  state: RecordingState;
  req: StartRequest;
  backend: CaptureBackend;
  backendReasons: string[];
  outDir: string;
  area: CaptureArea;
  session: Session | null;
  collector: TelemetryCollector | null;
  countdownTimer: unknown;
  tickTimer: unknown;
  ticking: boolean;
  startMs: number;
  paused: PausedRange[];
  recordedMs: number;
  micMuted: boolean;
  /** Mic mutes the backend could not apply live, in recorded ms (silenced in post). */
  mutedRanges: PausedRange[];
  firstFramePtsNs: bigint | null;
  lastStats: { fps: number; droppedFrames: number; fileBytes: number; micRms?: number | undefined };
  diskLowWarned: boolean;
  interrupted: { reason: InterruptReason; detail?: string | undefined } | null;
  stopReason: "user" | "maxLength" | null;
  stopPromise: Promise<void> | null;
  finalizePromise: Promise<FinalizeResponse> | null;
  result: FinalizeResponse | null;
}

export const DEFAULT_STATS_INTERVAL_MS = 1000;

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Keep a backend error's stable `code` (and `details`) when crossing IPC. */
function toRecordingError(err: unknown, fallbackCode: string): RecordingError {
  if (err instanceof RecordingError) return err;
  const e = err as { code?: unknown; details?: unknown } | null;
  const code = e && typeof e.code === "string" ? e.code : fallbackCode;
  return new RecordingError(code, errMessage(err), e?.details);
}

/** Closed, non-empty ranges; `undefined` when there are none. */
function closedRanges(
  ranges: readonly PausedRange[],
): { startMs: number; endMs: number }[] | undefined {
  const out = ranges
    .filter((r): r is { startMs: number; endMs: number } => r.endMs !== null && r.endMs > r.startMs)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }));
  return out.length > 0 ? out : undefined;
}

export interface RecordingController {
  handlers: RecordingHandlers;
  stateOf(sessionId: string): RecordingState | null;
  /**
   * App shutdown: cancels countdowns / pending starts and stops capturing
   * sessions cleanly so helpers are not orphaned and written media is kept.
   * Await it in `before-quit` when possible.
   */
  dispose(): Promise<void>;
}

export function createRecordingController(deps: RecordingDeps): RecordingController {
  const recs = new Map<string, Rec>();
  const statsInterval = deps.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS;

  const get = (sessionId: string): Rec => {
    const rec = recs.get(sessionId);
    if (!rec) throw new RecordingError("NO_SESSION", `unknown recording session ${sessionId}`);
    return rec;
  };

  const move = (rec: Rec, action: RecordingAction): void => {
    const next = transition(rec.state, action);
    if (next === null)
      throw new RecordingError("INVALID_STATE", `cannot ${action} while ${rec.state}`);
    rec.state = next;
  };

  const ensure = (rec: Rec, action: RecordingAction): void => {
    if (!canTransition(rec.state, action)) {
      throw new RecordingError("INVALID_STATE", `cannot ${action} while ${rec.state}`);
    }
  };

  const clearTimers = (rec: Rec): void => {
    if (rec.countdownTimer !== null) deps.timers.clearTimeout(rec.countdownTimer);
    if (rec.tickTimer !== null) deps.timers.clearTimeout(rec.tickTimer);
    rec.countdownTimer = null;
    rec.tickTimer = null;
  };

  const closePause = (rec: Rec, now: number): void => {
    const open = rec.paused[rec.paused.length - 1];
    if (open && open.endMs === null) open.endMs = now;
  };

  const liveRecordedMs = (rec: Rec): number =>
    isCapturing(rec.state)
      ? recordedDurationMs(rec.startMs, deps.nowMs(), rec.paused)
      : rec.recordedMs;

  const freezeRecordedMs = (rec: Rec): void => {
    if (!isCapturing(rec.state)) return;
    const now = deps.nowMs();
    closePause(rec, now);
    rec.recordedMs = recordedDurationMs(rec.startMs, now, rec.paused);
    const muted = rec.mutedRanges[rec.mutedRanges.length - 1];
    if (muted && muted.endMs === null) muted.endMs = rec.recordedMs;
  };

  // ---- interruption / stop ------------------------------------------------

  const interrupt = async (
    rec: Rec,
    reason: InterruptReason,
    detail?: string | undefined,
  ): Promise<void> => {
    if (!canTransition(rec.state, "interrupt") || rec.finalizePromise) return;
    freezeRecordedMs(rec);
    rec.state = "interrupted";
    rec.interrupted = { reason, detail };
    clearTimers(rec);
    rec.collector?.stop();
    deps.emit({
      sessionId: rec.id,
      type: "interrupted",
      reason,
      detail,
      recordedMs: rec.recordedMs,
    });
    // Stop cleanly, keeping everything written (§5.6).
    rec.stopPromise ??= (rec.session?.stop() ?? Promise.resolve()).catch(() => {});
    await rec.stopPromise;
  };

  const stopInternal = async (rec: Rec, reason: "user" | "maxLength"): Promise<void> => {
    freezeRecordedMs(rec);
    move(rec, "stop");
    rec.stopReason = reason;
    clearTimers(rec);
    rec.collector?.stop();
    deps.emit({ sessionId: rec.id, type: "stopped", recordedMs: rec.recordedMs, reason });
    rec.stopPromise ??= (rec.session?.stop() ?? Promise.resolve()).catch((err: unknown) => {
      void interrupt(rec, "other", errMessage(err));
    });
    await rec.stopPromise;
  };

  // ---- monitoring ---------------------------------------------------------

  const tick = async (rec: Rec): Promise<void> => {
    if (!isCapturing(rec.state) || rec.ticking) return;
    rec.ticking = true;
    try {
      const recordedMs = liveRecordedMs(rec);
      deps.emit({ sessionId: rec.id, type: "stats", recordedMs, ...rec.lastStats });
      if (maxLengthReached(recordedMs, effectiveMaxLengthMs(deps.settings().maxLengthMs))) {
        if (canTransition(rec.state, "stop")) await stopInternal(rec, "maxLength");
        return;
      }
      let free = Number.NaN;
      try {
        free = await deps.freeDiskBytes(rec.outDir);
      } catch {
        // Unknown free space never interrupts a recording.
      }
      if (!isCapturing(rec.state)) return;
      const status = diskStatus(free, diskWarningBytes(deps.settings().diskWarningThresholdGb));
      if (status === "critical") {
        await interrupt(rec, "diskLow");
      } else if (status === "low" && !rec.diskLowWarned) {
        rec.diskLowWarned = true;
        deps.emit({ sessionId: rec.id, type: "diskLow", freeBytes: free });
      }
    } finally {
      rec.ticking = false;
    }
  };

  const scheduleTick = (rec: Rec): void => {
    rec.tickTimer = deps.timers.setTimeout(() => {
      rec.tickTimer = null;
      void tick(rec).finally(() => {
        if (isCapturing(rec.state) && rec.tickTimer === null) scheduleTick(rec);
      });
    }, statsInterval);
  };

  const onCaptureEvent = (rec: Rec, ev: CaptureEvent): void => {
    switch (ev.type) {
      case "started":
        rec.firstFramePtsNs ??= ev.firstFramePtsNs;
        return;
      case "stats":
        rec.lastStats = {
          fps: ev.fps,
          droppedFrames: ev.droppedFrames,
          fileBytes: ev.fileBytes,
          micRms: ev.micRms,
        };
        return;
      case "interrupted":
        void interrupt(rec, ev.reason, ev.detail);
        return;
      case "deviceLost":
        deps.emit({ sessionId: rec.id, type: "deviceLost", device: ev.device });
        return;
    }
  };

  const unsubDisplay = deps.onDisplayRemoved?.((displayId) => {
    for (const rec of recs.values()) {
      if (isCapturing(rec.state) && rec.area.displayId === displayId)
        void interrupt(rec, "displayDisconnected");
    }
  });

  // ---- capture start ------------------------------------------------------

  const beginCapture = async (rec: Rec): Promise<void> => {
    if (rec.state !== "countdown") return;
    rec.countdownTimer = null;
    const backendId = rec.backend.id;
    if (deps.inputHook) {
      rec.collector = new TelemetryCollector({
        hook: deps.inputHook,
        nowNs: () => deps.hostNowNs(backendId),
        origin: rec.area.origin,
        bounds: rec.area.bounds,
        scaleFactor: rec.area.scaleFactor,
      });
      rec.collector.start();
    }
    let session: Session;
    try {
      session = await rec.backend.start(
        { ...rec.req, sessionId: rec.id, outDir: rec.outDir },
        (ev) => onCaptureEvent(rec, ev),
      );
    } catch (err) {
      rec.collector?.stop();
      rec.collector = null;
      if (rec.state === "countdown") {
        move(rec, "startFailed");
        await deps.removeDir(rec.outDir).catch(() => {});
        const code =
          err instanceof Error && "code" in err && typeof err.code === "string"
            ? err.code
            : "START_FAILED";
        deps.emit({ sessionId: rec.id, type: "error", code, message: errMessage(err) });
      }
      return;
    }
    if (rec.state !== "countdown") {
      // Discarded while the backend was starting.
      rec.collector?.stop();
      await session.discard().catch(() => {});
      await deps.removeDir(rec.outDir).catch(() => {});
      return;
    }
    rec.session = session;
    move(rec, "countdownDone");
    rec.startMs = deps.nowMs();
    deps.emit({ sessionId: rec.id, type: "started", backend: backendId });
    scheduleTick(rec);
  };

  const runCountdown = (rec: Rec, remaining: number): void => {
    if (rec.state !== "countdown") return;
    if (remaining <= 0) {
      void beginCapture(rec);
      return;
    }
    deps.emit({ sessionId: rec.id, type: "countdown", remaining });
    rec.countdownTimer = deps.timers.setTimeout(() => runCountdown(rec, remaining - 1), 1000);
  };

  // ---- finalize -------------------------------------------------------------

  const doFinalize = async (rec: Rec): Promise<FinalizeResponse> => {
    await rec.stopPromise;
    const session = rec.session;
    if (!session) throw new RecordingError("NO_MEDIA", "nothing was recorded");
    const stop = await session.close();
    const durationMs = stop.durationMs ?? rec.recordedMs;

    if (deps.fixWebmDuration) {
      for (const [track, path] of Object.entries(stop.paths) as [Track, string][]) {
        if (!/\.webm$/i.test(path)) continue;
        // A renderer track that started after the helper's first frame is shorter.
        const offsetMs = Math.max(0, stop.trackOffsetsMs?.[track] ?? 0);
        const trackMs = Math.max(0, durationMs - offsetMs);
        await deps.fixWebmDuration(path, trackMs).catch(() => {});
      }
    }

    const refs: Partial<Record<Track, MediaRef>> = {};
    for (const [track, path] of Object.entries(stop.paths) as [Track, string][]) {
      const bytes = await deps.fileSize(path);
      if (bytes !== null) refs[track] = { path, bytes };
    }
    const video = refs.screen;
    if (!video) {
      if (canTransition(rec.state, "interrupt")) {
        rec.state = "interrupted";
        rec.interrupted = { reason: "other", detail: "no video reached disk" };
      }
      throw new RecordingError("NO_MEDIA", "no video reached disk");
    }

    const keepTypedText = deps.settings().keepTypedText;
    const telemetry: TelemetryFile = rec.collector
      ? rec.collector.finalize({ firstFramePtsNs: rec.firstFramePtsNs, keepTypedText })
      : {
          version: 1,
          sampleHz: 120,
          origin: rec.area.origin,
          bounds: rec.area.bounds,
          scaleFactor: rec.area.scaleFactor,
          points: [],
          clicks: [],
          keys: [],
          scrolls: [],
        };
    const telemetryPath = deps.join(rec.outDir, "telemetry.json.gz");
    await deps.writeFile(telemetryPath, await encodeTelemetry(telemetry, deps.gzip));

    const meta: RecordingMeta = {
      backend: rec.backend.id,
      backendReasons: rec.backendReasons,
      os: deps.os,
      appVersion: deps.appVersion,
      createdAt: deps.nowIso(),
      source: rec.req.source,
      region: rec.req.region,
      scaleFactor: rec.area.scaleFactor,
      recordedFps: rec.req.fps,
      hideCursor: rec.req.hideCursor,
      durationMs,
      pausedRanges: rec.paused
        .filter((p): p is { startMs: number; endMs: number } => p.endMs !== null)
        .map((p) => ({ startMs: p.startMs - rec.startMs, endMs: p.endMs - rec.startMs })),
      firstFramePtsNs: rec.firstFramePtsNs === null ? null : rec.firstFramePtsNs.toString(),
      telemetryAligned: rec.firstFramePtsNs !== null,
      interrupted: rec.interrupted?.reason,
      interruptedDetail: rec.interrupted?.detail,
      stopReason: rec.stopReason ?? undefined,
      incompleteTracks: stop.incompleteTracks,
      webcamOffsetMs: refs.webcam ? stop.trackOffsetsMs?.webcam : undefined,
      micMutedRanges: refs.mic ? closedRanges(rec.mutedRanges) : undefined,
    };
    await deps.writeFile(
      deps.join(rec.outDir, "meta.json"),
      new TextEncoder().encode(JSON.stringify(meta, null, 2)),
    );

    let res: FinalizeResponse = {
      recordingId: rec.id,
      dir: rec.outDir,
      video,
      mic: refs.mic,
      system: refs.system,
      webcam: refs.webcam,
      telemetry: {
        path: telemetryPath,
        pointCount: telemetry.points.length,
        hasClicks: telemetry.clicks.length > 0,
        hasKeys: telemetry.keys.length > 0,
        sampleHz: telemetry.sampleHz,
      },
      meta,
    };
    if (deps.postProcess) res = await deps.postProcess(res);
    if (rec.state === "finalizing") move(rec, "finalized");
    rec.result = res;
    return res;
  };

  // ---- handlers -------------------------------------------------------------

  /** Session that accepts renderer chunks now (Electron backend, §5.2). */
  const chunkSession = (rec: Rec, op: "writeChunk" | "endTrack"): Session => {
    const session = rec.session;
    if (!session) throw new RecordingError("INVALID_STATE", `cannot ${op} while ${rec.state}`);
    if (!session[op])
      throw new RecordingError(
        "WRONG_BACKEND",
        `backend ${session.backend} does not accept chunks`,
      );
    if (!(isCapturing(rec.state) || rec.state === "finalizing" || rec.state === "interrupted")) {
      throw new RecordingError("INVALID_STATE", `cannot ${op} while ${rec.state}`);
    }
    return session;
  };

  const choose = async () => {
    const settings = deps.settings();
    const sel = await selectBackend({
      override: settings.backendOverride,
      platform: deps.platform,
      backends: deps.backends,
    });
    if (!sel.backend) {
      throw new RecordingError("BACKEND_UNAVAILABLE", "no capture backend is available", {
        reasons: sel.reasons,
      });
    }
    return { backend: sel.backend, reasons: sel.reasons };
  };

  const handlers: RecordingHandlers = {
    "recording:listSources": async () => {
      const { backend } = await choose();
      const sources = await backend.listSources();
      return { ...sources, backend: backend.id };
    },

    "recording:start": async (req) => {
      for (const r of recs.values()) {
        if (isActive(r.state))
          throw new RecordingError("SESSION_ACTIVE", "a recording is already in progress");
      }
      const id = deps.newId();
      const outDir = deps.join(deps.recordingsDir, id);
      // Placeholder until a backend is chosen; replaced below before any use.
      const rec: Rec = {
        id,
        state: "idle",
        req,
        backend: null as unknown as CaptureBackend,
        backendReasons: [],
        outDir,
        area: {
          origin: "display",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          scaleFactor: 1,
          displayId: null,
        },
        session: null,
        collector: null,
        countdownTimer: null,
        tickTimer: null,
        ticking: false,
        startMs: 0,
        paused: [],
        recordedMs: 0,
        micMuted: false,
        mutedRanges: [],
        firstFramePtsNs: null,
        lastStats: { fps: 0, droppedFrames: 0, fileBytes: 0 },
        diskLowWarned: false,
        interrupted: null,
        stopReason: null,
        stopPromise: null,
        finalizePromise: null,
        result: null,
      };
      move(rec, "prepare");
      recs.set(id, rec);
      const stillPreparing = (): void => {
        if (rec.state !== "preparing")
          throw new RecordingError("DISCARDED", "recording was cancelled");
      };
      let dirCreated = false;
      try {
        const { backend, reasons } = await choose();
        rec.backend = backend;
        rec.backendReasons = reasons;
        stillPreparing();

        const perms = await deps.checkPermissions(req, backend.id);
        stillPreparing();
        if (!perms.ok) {
          throw new RecordingError("PERMISSION_DENIED", "capture permission missing", {
            missing: perms.missing ?? [],
          });
        }

        const free = await deps.freeDiskBytes(deps.recordingsDir);
        stillPreparing();
        if (!canStartWithFreeBytes(free)) {
          throw new RecordingError("DISK_LOW", "at least 2 GB of free disk space is required", {
            freeBytes: free,
          });
        }

        const area = resolveCaptureArea(await backend.listSources(), req);
        stillPreparing();
        if (!area)
          throw new RecordingError(
            "SOURCE_NOT_FOUND",
            "the selected screen or window is no longer available",
          );
        rec.area = area;

        await deps.mkdir(outDir);
        dirCreated = true;
        stillPreparing();
      } catch (err) {
        if (rec.state === "preparing") move(rec, "prepareFailed");
        if (rec.state === "idle") recs.delete(id);
        if (dirCreated) await deps.removeDir(outDir).catch(() => {});
        throw err;
      }
      move(rec, "prepared");
      runCountdown(rec, req.countdown);
      return { sessionId: id, backend: rec.backend.id, backendReasons: rec.backendReasons };
    },

    "recording:pause": async ({ sessionId }) => {
      const rec = get(sessionId);
      ensure(rec, "pause");
      await rec.session?.pause();
      ensure(rec, "pause");
      move(rec, "pause");
      rec.paused.push({ startMs: deps.nowMs(), endMs: null });
      rec.collector?.pause();
      deps.emit({ sessionId, type: "paused", recordedMs: liveRecordedMs(rec) });
      return { ok: true as const };
    },

    "recording:resume": async ({ sessionId }) => {
      const rec = get(sessionId);
      ensure(rec, "resume");
      await rec.session?.resume();
      ensure(rec, "resume");
      move(rec, "resume");
      closePause(rec, deps.nowMs());
      rec.collector?.resume();
      deps.emit({ sessionId, type: "resumed", recordedMs: liveRecordedMs(rec) });
      return { ok: true as const };
    },

    "recording:stop": async ({ sessionId }) => {
      const rec = get(sessionId);
      ensure(rec, "stop");
      await stopInternal(rec, "user");
      return { ok: true as const };
    },

    "recording:discard": async ({ sessionId }) => {
      const rec = get(sessionId);
      if (rec.state === "discarded") return { ok: true as const };
      ensure(rec, "discard");
      if (rec.finalizePromise)
        throw new RecordingError("FINALIZING", "recording is being finalized");
      move(rec, "discard");
      clearTimers(rec);
      rec.collector?.stop();
      await rec.session?.discard().catch(() => {});
      await deps.removeDir(rec.outDir).catch(() => {});
      deps.emit({ sessionId, type: "discarded" });
      return { ok: true as const };
    },

    "recording:setMicMuted": async ({ sessionId, muted }) => {
      const rec = get(sessionId);
      if (!isCapturing(rec.state) || !rec.session) {
        throw new RecordingError("INVALID_STATE", `cannot change the mic while ${rec.state}`);
      }
      if (!rec.req.audio.mic) return { ok: true as const, applied: true };
      let applied: boolean;
      try {
        applied = (await rec.session.setMicMuted?.(muted)) ?? false;
      } catch (err) {
        throw toRecordingError(err, "MIC_MUTE_FAILED");
      }
      if (rec.micMuted !== muted) {
        rec.micMuted = muted;
        const at = liveRecordedMs(rec);
        const open = rec.mutedRanges[rec.mutedRanges.length - 1];
        if (muted && !applied) rec.mutedRanges.push({ startMs: at, endMs: null });
        else if (!muted && open && open.endMs === null) open.endMs = at;
      }
      return { ok: true as const, applied };
    },

    "recording:writeChunk": async ({ sessionId, track, seq, chunk, timing }) => {
      const rec = get(sessionId);
      const write = chunkSession(rec, "writeChunk").writeChunk;
      if (!write) throw new RecordingError("WRONG_BACKEND", "backend does not accept chunks");
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      try {
        await write(track, bytes, seq, timing);
      } catch (err) {
        throw toRecordingError(err, "WRITE_FAILED");
      }
      return { ok: true as const };
    },

    "recording:endTrack": async ({ sessionId, track, chunkCount }) => {
      const rec = get(sessionId);
      const end = chunkSession(rec, "endTrack").endTrack;
      if (!end) throw new RecordingError("WRONG_BACKEND", "backend does not accept chunks");
      try {
        const res = await end(track, chunkCount);
        return { ok: true as const, chunkCount: res.chunkCount };
      } catch (err) {
        throw toRecordingError(err, "END_TRACK_FAILED");
      }
    },

    "recording:finalize": async ({ sessionId }) => {
      const rec = get(sessionId);
      if (rec.result) return rec.result;
      if (rec.finalizePromise) return rec.finalizePromise;
      if (rec.state !== "finalizing" && rec.state !== "interrupted") {
        throw new RecordingError("INVALID_STATE", `cannot finalize while ${rec.state}`);
      }
      rec.finalizePromise = doFinalize(rec).catch((err: unknown) => {
        rec.finalizePromise = null;
        throw err;
      });
      return rec.finalizePromise;
    },
  };

  return {
    handlers,
    stateOf: (sessionId) => recs.get(sessionId)?.state ?? null,
    dispose: async () => {
      unsubDisplay?.();
      const pending: Promise<unknown>[] = [];
      for (const rec of recs.values()) {
        if (isCapturing(rec.state)) {
          pending.push(stopInternal(rec, "user").catch(() => {}));
        } else if (rec.state === "preparing" || rec.state === "countdown") {
          // Nothing recorded yet; beginCapture discards a backend still starting.
          rec.state = "discarded";
          clearTimers(rec);
          pending.push(deps.removeDir(rec.outDir).catch(() => {}));
        } else if (rec.stopPromise) {
          pending.push(rec.stopPromise);
        }
        clearTimers(rec);
        rec.collector?.stop();
      }
      await Promise.all(pending);
    },
  };
}

export function createRecordingHandlers(deps: RecordingDeps): RecordingHandlers {
  return createRecordingController(deps).handlers;
}
