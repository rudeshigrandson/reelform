import { ChunkError, ChunkTracks, type TrackWriter } from "./chunkTracks";
import { electronFirstFrameEpochNs } from "./electronBackend";
import {
  type HelperMessage,
  type HelperProcess,
  START_TIMEOUT_MS,
  type Timers,
} from "./helperProcess";
import type { VerifyResult } from "./manifest";
import {
  type Availability,
  type BackendId,
  type CaptureBackend,
  type ChunkTiming,
  type EventSink,
  type InterruptReason,
  type Rect,
  type Session,
  type SourceRef,
  Sources,
  type StartOptions,
  type StopResult,
  type Track,
} from "./types";

/**
 * Generic native backend over a helper process (§5.3/§5.4/§5.5). Maps the
 * helper protocol onto {@link Session}:
 *
 *   main → helper  `start` `pause` `resume` `stop` `discard` `listSources` (each with `id`),
 *                  `setMicMuted{muted}` (only when the helper advertises `micMute`)
 *   helper → main  `ready{id}` (reply to start), `started{firstFramePtsNs}`,
 *                  `stats{fps,droppedFrames,fileBytes,micRms?}`, `interrupted{reason}`,
 *                  `deviceLost{device}`, `stopped{id?,durationMs,paths}`,
 *                  `sources{id,displays,windows}`, `error{id,code,message}`.
 *
 * Liveness: while capturing (recording or paused) the helper must emit `stats`
 * at least every second — main's watchdog kills a helper silent for 5s. The
 * watchdog is disarmed once `stop`/`discard` is sent.
 *
 * `firstFramePtsNs` may be a JSON number or a decimal string (host-clock ns can
 * exceed 2^53 on long-uptime machines).
 *
 * Webcam (§5.7): the helpers never open the camera. The renderer records it with
 * a MediaRecorder and streams chunks here (`writeChunk`/`endTrack`, webcam
 * track only) into `<outDir>/webcam.webm`. The first webcam chunk carries its
 * recorder timing; its offset from the helper's `started` (both on the epoch
 * clock) is reported as `trackOffsetsMs.webcam`.
 */

/** Finalizing writers can take a while on long recordings. */
export const STOP_TIMEOUT_MS = 60_000;
export const CAPTURE_CAP = "capture";
/** Helper capability for a live `setMicMuted` command. */
export const MIC_MUTE_CAP = "micMute";
/** Tracks a native session accepts from the renderer. */
export const RENDERER_TRACKS: readonly Track[] = ["webcam"];

export interface HelperBackendConfig {
  id: Exclude<BackendId, "electron">;
  /** `process.platform` the helper targets. */
  targetPlatform: string;
  /** Human OS name used in the unavailable reason. */
  targetOsName: string;
  currentPlatform: string;
  /** sha256 manifest check (§5.5). */
  verify(): Promise<VerifyResult>;
  /** Build (but do not start) a helper process for the verified binary path. */
  createHelper(binaryPath: string): HelperProcess;
  join(...parts: string[]): string;
  /** Capability the helper must advertise in `pong.caps`. */
  requiredCap?: string | undefined;
  /** Opens the renderer-recorded webcam file. Without it webcam chunks are refused. */
  openWriter?: ((path: string) => Promise<TrackWriter>) | undefined;
  /** Grace period timers for the renderer's final webcam flush on close. */
  timers?: Timers | undefined;
  endTrackGraceMs?: number | undefined;
  /** Epoch ms clock (same clock as renderer `performance.timeOrigin + now()`). */
  nowEpochMs?: (() => number) | undefined;
  /**
   * Extra `source.bounds` sent to the helper (Windows: the display's bounds in
   * virtual-desktop physical px, since Electron display ids are not HMONITORs).
   */
  resolveSourceBounds?: ((source: SourceRef) => Rect | null) | undefined;
}

const INTERRUPT_REASONS: readonly InterruptReason[] = [
  "displayDisconnected",
  "helperCrash",
  "diskLow",
  "deviceLost",
  "other",
];

/** Parse `firstFramePtsNs` from a helper message. */
export function parsePtsNs(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function parsePaths(v: unknown): Partial<Record<Track, string>> {
  const out: Partial<Record<Track, string>> = {};
  if (typeof v !== "object" || v === null) return out;
  const rec = v as Record<string, unknown>;
  for (const k of ["screen", "mic", "system", "webcam"] as const) {
    const p = rec[k];
    if (typeof p === "string" && p.length > 0) out[k] = p;
  }
  return out;
}

/** Map a helper message to a sink event; `null` for messages the sink does not see. */
export function mapHelperEvent(msg: HelperMessage): Parameters<EventSink>[0] | null {
  switch (msg.t) {
    case "started": {
      const pts = parsePtsNs(msg.firstFramePtsNs);
      return pts === null ? null : { type: "started", firstFramePtsNs: pts };
    }
    case "stats":
      return {
        type: "stats",
        fps: num(msg.fps),
        droppedFrames: num(msg.droppedFrames),
        fileBytes: num(msg.fileBytes),
        micRms: typeof msg.micRms === "number" ? msg.micRms : undefined,
      };
    case "interrupted": {
      const r = msg.reason;
      const known = INTERRUPT_REASONS.find((k) => k === r);
      return {
        type: "interrupted",
        reason: known ?? "other",
        detail: known ? undefined : typeof r === "string" ? r : undefined,
      };
    }
    case "deviceLost":
      return {
        type: "deviceLost",
        device: typeof msg.device === "string" ? msg.device : "unknown",
      };
    default:
      return null;
  }
}

/** Files a native helper is expected to have written — used when it crashed before `stopped`. */
export function expectedNativePaths(
  opts: StartOptions,
  join: (...p: string[]) => string,
): Partial<Record<Track, string>> {
  const out: Partial<Record<Track, string>> = { screen: join(opts.outDir, "screen.mp4") };
  if (opts.audio.system) out.system = join(opts.outDir, "system.m4a");
  if (opts.audio.mic) out.mic = join(opts.outDir, "mic.m4a");
  return out;
}

/** The `start` command body sent to a helper. */
export function helperStartMessage(
  opts: StartOptions,
  bounds: Rect | null = null,
): { t: "start"; [key: string]: unknown } {
  const audio: Record<string, unknown> = { system: opts.audio.system };
  if (opts.audio.mic !== undefined) audio.mic = opts.audio.mic;
  if (opts.audio.micLabel) audio.micLabel = opts.audio.micLabel;
  if (opts.audio.micEndpointId) audio.micEndpointId = opts.audio.micEndpointId;
  return {
    t: "start",
    sessionId: opts.sessionId,
    outDir: opts.outDir,
    source: bounds && opts.source.kind === "display" ? { ...opts.source, bounds } : opts.source,
    region: opts.region,
    audio,
    fps: opts.fps,
    hideCursor: opts.hideCursor,
  };
}

const wantsMic = (opts: StartOptions): boolean =>
  opts.audio.mic !== undefined || !!opts.audio.micLabel || !!opts.audio.micEndpointId;

class HelperSession implements Session {
  private stopResult: StopResult | null = null;
  private stopping: Promise<void> | null = null;
  /** Set once the helper has reported a clean end (stopped / discarded). */
  private finished = false;
  private caps: readonly string[] = [];
  private readonly chunks: ChunkTracks | null;
  private startedEpochMs: number | null = null;
  private webcamEpochMs: number | null = null;
  private closing: Promise<StopResult> | null = null;

  constructor(
    readonly backend: BackendId,
    private readonly helper: HelperProcess,
    private readonly opts: StartOptions,
    private readonly cfg: HelperBackendConfig,
    sink: EventSink,
  ) {
    const openWriter = cfg.openWriter;
    this.chunks = openWriter
      ? new ChunkTracks({
          pathFor: (track) => cfg.join(opts.outDir, `${track}.webm`),
          openWriter,
          // The screen recording is unaffected; only a full disk interrupts.
          onWriteError: (err, track) => {
            const code = (err as { code?: unknown } | null)?.code;
            if (code === "ENOSPC") {
              sink({ type: "interrupted", reason: "diskLow", detail: `${track}: disk full` });
            }
          },
          timers: cfg.timers,
          endTrackGraceMs: cfg.endTrackGraceMs,
        })
      : null;
  }

  setCaps(caps: readonly string[]): void {
    this.caps = caps;
  }

  markStarted(): void {
    if (this.startedEpochMs === null && this.cfg.nowEpochMs) {
      this.startedEpochMs = this.cfg.nowEpochMs();
    }
  }

  markStopped(msg: HelperMessage): void {
    this.finished = true;
    this.stopResult = {
      durationMs: typeof msg.durationMs === "number" ? msg.durationMs : null,
      paths: { ...expectedNativePaths(this.opts, this.cfg.join), ...parsePaths(msg.paths) },
    };
  }

  get isFinished(): boolean {
    return this.finished;
  }

  async pause(): Promise<void> {
    await this.helper.request({ t: "pause" });
  }

  async resume(): Promise<void> {
    await this.helper.request({ t: "resume" });
  }

  async setMicMuted(muted: boolean): Promise<boolean> {
    if (!wantsMic(this.opts)) return true;
    if (!this.caps.includes(MIC_MUTE_CAP)) return false;
    await this.helper.request({ t: "setMicMuted", muted });
    return true;
  }

  private rendererChunks(track: Track): ChunkTracks {
    if (!this.chunks || !RENDERER_TRACKS.includes(track)) {
      throw new ChunkError(
        "WRONG_TRACK",
        `backend ${this.backend} does not accept ${track} chunks`,
      );
    }
    return this.chunks;
  }

  writeChunk = async (
    track: Track,
    chunk: Uint8Array,
    seq: number,
    timing?: ChunkTiming | undefined,
  ): Promise<void> => {
    const chunks = this.rendererChunks(track);
    await chunks.write(track, chunk, seq, () => {
      if (timing && seq === 0 && this.webcamEpochMs === null) {
        this.webcamEpochMs = Number(electronFirstFrameEpochNs(timing, this.opts.fps) / 1000n) / 1000;
      }
    });
  };

  endTrack = async (track: Track, chunkCount: number): Promise<{ chunkCount: number }> =>
    this.rendererChunks(track).end(track, chunkCount);

  stop(): Promise<void> {
    if (this.stopResult) return Promise.resolve();
    this.stopping ??= (async () => {
      // Finalizing writers (moov rewrite) can keep the helper silent for longer
      // than the watchdog window; STOP_TIMEOUT_MS bounds the wait instead.
      this.helper.disarmWatchdog();
      try {
        if (this.helper.running) {
          const res = await this.helper.request({ t: "stop" }, STOP_TIMEOUT_MS);
          this.markStopped(res);
        }
      } catch {
        // Crashed / timed out: keep whatever reached disk (§5.6).
      } finally {
        this.finished = true;
        this.helper.disarmWatchdog();
        await this.helper.kill();
        this.stopResult ??= {
          durationMs: null,
          paths: expectedNativePaths(this.opts, this.cfg.join),
        };
      }
    })();
    return this.stopping;
  }

  async discard(): Promise<void> {
    this.finished = true;
    this.helper.disarmWatchdog();
    try {
      if (this.helper.running) await this.helper.request({ t: "discard" });
    } catch {
      // The controller removes the output directory regardless.
    } finally {
      this.helper.disarmWatchdog();
      await this.helper.kill();
      await this.chunks?.close(false);
      this.stopResult ??= { durationMs: null, paths: {} };
    }
  }

  close(): Promise<StopResult> {
    this.closing ??= (async () => {
      await this.stop();
      // stop() always assigns a result in its finally block.
      const base = this.stopResult ?? { durationMs: null, paths: {} };
      if (!this.chunks) return base;
      const rendered = await this.chunks.close(true);
      const res: StopResult = { ...base, paths: { ...base.paths, ...rendered.paths } };
      if (rendered.incompleteTracks) res.incompleteTracks = rendered.incompleteTracks;
      if (rendered.paths.webcam && this.webcamEpochMs !== null && this.startedEpochMs !== null) {
        res.trackOffsetsMs = { webcam: Math.round(this.webcamEpochMs - this.startedEpochMs) };
      }
      return res;
    })();
    return this.closing;
  }
}

export function createHelperBackend(cfg: HelperBackendConfig): CaptureBackend {
  const requiredCap = cfg.requiredCap ?? CAPTURE_CAP;
  let cached: Availability | null = null;

  const verifiedPath = async (): Promise<string> => {
    const v = await cfg.verify();
    if (!v.ok) throw new Error(v.reason);
    return v.path;
  };

  const withHelper = async <T>(fn: (h: HelperProcess) => Promise<T>): Promise<T> => {
    const helper = cfg.createHelper(await verifiedPath());
    try {
      await helper.start();
      return await fn(helper);
    } finally {
      await helper.kill();
    }
  };

  return {
    id: cfg.id,

    async isAvailable(): Promise<Availability> {
      if (cached) return cached;
      if (cfg.currentPlatform !== cfg.targetPlatform) {
        cached = { ok: false, reason: `requires ${cfg.targetOsName}` };
        return cached;
      }
      const v = await cfg.verify();
      if (!v.ok) {
        cached = { ok: false, reason: v.reason };
        return cached;
      }
      const helper = cfg.createHelper(v.path);
      try {
        const pong = await helper.start();
        cached = pong.caps.includes(requiredCap)
          ? { ok: true }
          : {
              ok: false,
              reason: `helper ${pong.version || "?"} lacks "${requiredCap}" capability`,
            };
      } catch (err) {
        // Transient spawn failures are not cached so a retry can succeed.
        return {
          ok: false,
          reason: `helper ping failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      } finally {
        await helper.kill();
      }
      return cached;
    },

    listSources(): Promise<Sources> {
      return withHelper(async (h) => {
        const res = await h.request({ t: "listSources" });
        return Sources.parse({ displays: res.displays, windows: res.windows });
      });
    },

    async start(opts: StartOptions, sink: EventSink): Promise<Session> {
      const helper = cfg.createHelper(await verifiedPath());
      const session = new HelperSession(cfg.id, helper, opts, cfg, sink);
      helper.onEvent((msg) => {
        if (msg.t === "stopped") {
          session.markStopped(msg);
          return;
        }
        const ev = mapHelperEvent(msg);
        if (ev?.type === "started") session.markStarted();
        if (ev) sink(ev);
      });
      helper.onExit((info) => {
        if (info.expected || session.isFinished) return;
        const detail = info.cause ?? info.stderrTail[info.stderrTail.length - 1];
        sink({ type: "interrupted", reason: "helperCrash", detail });
      });
      try {
        const pong = await helper.start();
        session.setCaps(pong.caps);
        const bounds = cfg.resolveSourceBounds?.(opts.source) ?? null;
        const res = await helper.request(helperStartMessage(opts, bounds), START_TIMEOUT_MS);
        if (res.t !== "ready") throw new Error(`unexpected helper reply "${res.t}" to start`);
      } catch (err) {
        await helper.kill();
        throw err;
      }
      helper.armWatchdog();
      return session;
    },
  };
}
