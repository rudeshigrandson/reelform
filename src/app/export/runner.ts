import { SpeedMap } from "../../editor/audio/speedMap";
import { serializeSidecar } from "../../editor/captions/sidecar";
import type { EditorData } from "../../editor/store";
import { isCancelled } from "../../export/engine/cancel";
import { EncoderUnsupportedError } from "../../export/engine/encoderConfig";
import { EncoderFailure } from "../../export/engine/engine";
import type { ExportSink } from "../../export/engine/muxer";
import type { EncoderKind, ExportProgress } from "../../export/engine/progress";
import type { GifEncoderOptions } from "../../export/gif/types";
import type { ExportConfig } from "../../export/route";
import {
  type ExportFlowConfig,
  type TimeRange,
  formatBytes,
  gifDimensions,
  outputFileName,
  sidecarName,
  toEngineConfig,
} from "./config";
import type { FileSinkBeginInfo, SinkBeginInfo } from "./exportSink";
import type { SystemPort } from "./systemPort";
import type { ExportProgressData } from "./useExportProgress";

/**
 * Export flow state machine (guide S22 states, §10.7): configuring → running →
 * done | failed | low-disk | codec-unsupported | cancelled. Engines, sinks and
 * the shell are injected so every transition is testable without WebCodecs.
 */

export type Caption = EditorData["captions"][number];
export type SpeedRegionLike = { startMs: number; endMs: number; rate: number };

export type ExportFlowPhase =
  | { kind: "configuring" }
  | {
      kind: "running";
      fileName: string;
      progress: ExportProgress;
      /** GIF live size estimate (bytes), null until settled data exists. */
      estimatedBytes: number | null;
      notice: string | null;
      cancelling: boolean;
    }
  | {
      kind: "done";
      fileName: string;
      path: string;
      bytes: number;
      sidecars: string[];
      encoder: EncoderKind | null;
      notice: string | null;
    }
  | {
      kind: "failed";
      code: string;
      message: string;
      canRetrySoftware: boolean;
      diagnostics: string;
    }
  | { kind: "low-disk"; message: string; diagnostics: string }
  | { kind: "codec-unsupported"; codec: string; message: string; diagnostics: string }
  | { kind: "cancelled" };

export interface ExportRequest {
  config: ExportFlowConfig;
  projectId: string;
  range: TimeRange;
  /** Source aspect for GIF sizing. */
  sourceSize: { width: number; height: number };
  preferHardware: boolean;
  /** Shown while running / on done (e.g. software fallback). */
  notice?: string | null | undefined;
  captions: readonly Caption[];
  speeds: readonly SpeedRegionLike[];
}

export interface VideoRouteArgs {
  config: ExportConfig;
  range: TimeRange;
  preferHardware: boolean;
  includeAudio: boolean;
  burnInCaptions: boolean;
  sink: ExportSink;
  signal: AbortSignal;
  onProgress(progress: ExportProgress): void;
}

export interface VideoRouteResult {
  path: string;
  encoder: EncoderKind;
  attempts: number;
  pcmWav: Uint8Array | null;
}

/**
 * The file sink the flow hands to routes: an engine `ExportSink` whose `begin`
 * also accepts non-video containers (GIF, sidecars) and that reports its size.
 */
export interface FlowSink extends Omit<ExportSink, "begin"> {
  begin(info?: SinkBeginInfo | undefined): Promise<void>;
  readonly size: number;
}

export interface GifRouteArgs {
  options: Omit<GifEncoderOptions, "totalFrames">;
  range: TimeRange;
  burnInCaptions: boolean;
  sink: FlowSink;
  signal: AbortSignal;
  onProgress(progress: ExportProgress, estimatedBytes: number | null): void;
}

export interface GifRouteResult {
  path: string;
  bytes: number;
  frames: number;
}

export interface SinkTarget {
  projectId: string;
  destinationDir: string | null;
  finalName: string;
}

export interface ExportRunnerDeps {
  runVideo(args: VideoRouteArgs): Promise<VideoRouteResult>;
  runGif(args: GifRouteArgs): Promise<GifRouteResult>;
  createSink(target: SinkTarget): FlowSink;
  writeFile(
    target: SinkTarget,
    container: FileSinkBeginInfo["container"],
    bytes: Uint8Array,
  ): Promise<string>;
  system: SystemPort;
  onChange(phase: ExportFlowPhase): void;
  now(): number;
  /** Extra context for "Copy diagnostics" (app version, OS, caps…). */
  environment?: (() => Record<string, unknown>) | undefined;
}

export interface ExportRunner {
  phase(): ExportFlowPhase;
  start(request: ExportRequest): Promise<ExportFlowPhase>;
  /** Re-run the last request on the software encoder. */
  retrySoftware(): Promise<ExportFlowPhase>;
  cancel(): void;
  /** Back to configuring (Export another). No-op while running. */
  reset(): void;
  copyDiagnostics(): Promise<void>;
  lastRequest(): ExportRequest | null;
}

const LOW_DISK_ERRNO = new Set(["ENOSPC", "EDQUOT"]);

interface CodedError {
  code?: unknown;
  details?: unknown;
  message?: unknown;
}

function errorCode(e: unknown): string {
  if (e instanceof EncoderFailure) return "ENCODER_FAILED";
  if (e instanceof EncoderUnsupportedError) return "ENCODER_UNSUPPORTED";
  const c = (e as CodedError | null)?.code;
  if (typeof c === "string") return c;
  return e instanceof Error && e.name !== "Error" ? e.name : "EXPORT_FAILED";
}

export function isLowDisk(e: unknown): boolean {
  const { code, details } = (e ?? {}) as CodedError;
  if (typeof code === "string" && LOW_DISK_ERRNO.has(code)) return true;
  const errno = (details as { errno?: unknown } | null | undefined)?.errno;
  return typeof errno === "string" && LOW_DISK_ERRNO.has(errno);
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";

/** Captions re-timed onto the exported output (range start = 0, speeds applied). */
export function captionsForOutput(
  captions: readonly Caption[],
  range: TimeRange,
  speeds: readonly SpeedRegionLike[],
): Caption[] {
  const map = new SpeedMap(speeds);
  const base = map.timelineToOutput(range.startMs);
  const out: Caption[] = [];
  for (const c of captions) {
    const s = Math.max(c.startMs, range.startMs);
    const e = Math.min(c.endMs, range.endMs);
    if (!(e > s)) continue;
    const startMs = Math.round(map.timelineToOutput(s) - base);
    const endMs = Math.round(map.timelineToOutput(e) - base);
    if (endMs > startMs) out.push({ ...c, startMs, endMs });
  }
  return out;
}

const preparing = (encoder: EncoderKind): ExportProgress => ({
  phase: "preparing",
  label: "Preparing",
  framesDone: 0,
  framesTotal: 0,
  fraction: 0,
  etaMs: null,
  speed: null,
  encoder,
});

export function createExportRunner(deps: ExportRunnerDeps): ExportRunner {
  let phase: ExportFlowPhase = { kind: "configuring" };
  let request: ExportRequest | null = null;
  let abort: AbortController | null = null;
  let activeSink: FlowSink | null = null;
  let lastError: unknown = null;
  let attemptEncoder: EncoderKind | null = null;

  const set = (next: ExportFlowPhase): void => {
    phase = next;
    deps.onChange(next);
  };

  const diagnostics = (): string => {
    const err = lastError;
    return JSON.stringify(
      {
        kind: "reelform-export-diagnostics",
        at: new Date(deps.now()).toISOString(),
        request: request && {
          config: request.config,
          range: request.range,
          preferHardware: request.preferHardware,
          sourceSize: request.sourceSize,
        },
        encoder: attemptEncoder,
        error: err
          ? {
              code: errorCode(err),
              name: err instanceof Error ? err.name : typeof err,
              message: messageOf(err),
              details: (err as CodedError).details,
              cause: err instanceof Error && err.cause ? messageOf(err.cause) : undefined,
            }
          : null,
        environment: deps.environment?.() ?? {},
      },
      null,
      2,
    );
  };

  const run = async (req: ExportRequest): Promise<ExportFlowPhase> => {
    if (phase.kind === "running") throw new Error("an export is already running");
    request = req;
    lastError = null;
    const { config } = req;
    const controller = new AbortController();
    abort = controller;
    const fileName = outputFileName(config.fileName, config.format);
    const target: SinkTarget = {
      projectId: req.projectId,
      destinationDir: config.destinationDir,
      finalName: fileName,
    };
    const notice = req.notice ?? null;
    attemptEncoder = config.format === "gif" ? null : req.preferHardware ? "hardware" : "software";
    const running = (progress: ExportProgress, estimatedBytes: number | null = null): void => {
      if (abort !== controller) return;
      const cancelling = phase.kind === "running" && phase.cancelling;
      set({ kind: "running", fileName, progress, estimatedBytes, notice, cancelling });
    };
    running(preparing(attemptEncoder ?? "software"));

    const sink = deps.createSink(target);
    activeSink = sink;
    try {
      let path: string;
      let bytes: number;
      let pcmWav: Uint8Array | null = null;
      const burnInCaptions = config.captions === "burn-in";
      if (config.format === "gif") {
        const size = gifDimensions(config.gif.sizePreset, req.sourceSize);
        const res = await deps.runGif({
          options: {
            ...size,
            fps: config.gif.fps,
            colors: config.gif.colors,
            dither: config.gif.dither,
            loop: config.gif.loop,
          },
          range: req.range,
          burnInCaptions,
          sink,
          signal: controller.signal,
          onProgress: (p, est) => running(p, est),
        });
        path = res.path;
        bytes = res.bytes;
      } else {
        const res = await deps.runVideo({
          config: toEngineConfig(config),
          range: req.range,
          preferHardware: req.preferHardware,
          includeAudio: config.audio === "aac",
          burnInCaptions,
          sink,
          signal: controller.signal,
          onProgress: (p) => {
            attemptEncoder = p.encoder;
            running(p);
          },
        });
        attemptEncoder = res.encoder;
        path = res.path;
        bytes = sink.size;
        pcmWav = res.pcmWav;
      }
      if (controller.signal.aborted) throw new DOMException("Export cancelled", "AbortError");

      const sidecars: string[] = [];
      const notices: string[] = notice ? [notice] : [];
      const sideTarget = (ext: string): SinkTarget => ({
        ...target,
        finalName: sidecarName(path, ext),
      });
      if (config.captions === "srt" || config.captions === "vtt") {
        const text = serializeSidecar(
          captionsForOutput(req.captions, req.range, req.speeds),
          config.captions,
        );
        try {
          sidecars.push(
            await deps.writeFile(
              sideTarget(config.captions),
              config.captions,
              new TextEncoder().encode(text),
            ),
          );
        } catch (e) {
          notices.push(`Captions file could not be written: ${messageOf(e)}`);
        }
      }
      if (pcmWav) {
        try {
          sidecars.push(await deps.writeFile(sideTarget("wav"), "wav", pcmWav));
          notices.push(
            "AAC audio isn't available on this device — audio was saved next to the video as WAV",
          );
        } catch (e) {
          notices.push(`Audio could not be written: ${messageOf(e)}`);
        }
      }
      if (config.revealAfter) {
        await deps.system.reveal(path).catch(() => undefined);
      }
      if (config.copyAfter) {
        try {
          await deps.system.clipboardWriteFile(path);
        } catch {
          notices.push("Couldn't copy the file to the clipboard");
        }
      }
      abort = null;
      activeSink = null;
      set({
        kind: "done",
        fileName: path.split(/[\\/]/).pop() ?? fileName,
        path,
        bytes,
        sidecars,
        encoder: attemptEncoder,
        notice: notices.length > 0 ? notices.join(" · ") : null,
      });
    } catch (e) {
      await sink.cancel().catch(() => undefined);
      abort = null;
      activeSink = null;
      if (controller.signal.aborted || isCancelled(e)) {
        set({ kind: "cancelled" });
        return phase;
      }
      lastError = e;
      const code = errorCode(e);
      if (isLowDisk(e)) {
        set({
          kind: "low-disk",
          message:
            "There isn't enough disk space to finish this export. Free up space or choose another folder.",
          diagnostics: diagnostics(),
        });
      } else if (e instanceof EncoderUnsupportedError) {
        set({
          kind: "codec-unsupported",
          codec: config.codec,
          message: `${config.codec.toUpperCase()} isn't supported on this device. Choose another codec.`,
          diagnostics: diagnostics(),
        });
      } else {
        set({
          kind: "failed",
          code,
          message: messageOf(e),
          canRetrySoftware: config.format !== "gif",
          diagnostics: diagnostics(),
        });
      }
    }
    return phase;
  };

  return {
    phase: () => phase,
    start: run,
    retrySoftware: () => {
      if (!request) return Promise.reject(new Error("nothing to retry"));
      if (phase.kind === "running") return Promise.resolve(phase);
      return run({
        ...request,
        preferHardware: false,
        notice: "Using the software encoder",
      });
    },
    cancel() {
      if (!abort || phase.kind !== "running") return;
      set({ ...phase, cancelling: true });
      abort.abort();
      void activeSink?.cancel().catch(() => undefined);
    },
    reset() {
      if (phase.kind === "running") return;
      set({ kind: "configuring" });
    },
    copyDiagnostics: () => deps.system.copyText(diagnostics()),
    lastRequest: () => request,
  };
}

/** Map a flow phase onto the shared progress store (top-bar ring + toasts). */
export function progressPatchFor(phase: ExportFlowPhase): Partial<ExportProgressData> {
  switch (phase.kind) {
    case "running":
      return {
        activity: "running",
        fraction: phase.progress.fraction,
        label: phase.progress.label,
        framesDone: phase.progress.framesDone,
        framesTotal: phase.progress.framesTotal,
        etaMs: phase.progress.etaMs,
        speed: phase.progress.speed,
        fileName: phase.fileName,
        estimatedBytes: phase.estimatedBytes,
        path: null,
        bytes: null,
        error: null,
      };
    case "done":
      return {
        activity: "done",
        fraction: 1,
        label: `Exported · ${phase.fileName} (${formatBytes(phase.bytes)})`,
        etaMs: 0,
        fileName: phase.fileName,
        path: phase.path,
        bytes: phase.bytes,
        error: null,
      };
    case "failed":
    case "low-disk":
    case "codec-unsupported":
      return { activity: "failed", label: "Export failed", etaMs: null, error: phase.message };
    case "cancelled":
    case "configuring":
      return {
        activity: phase.kind === "cancelled" ? "cancelled" : "idle",
        fraction: 0,
        label: "",
        etaMs: null,
        speed: null,
        error: null,
      };
  }
}
