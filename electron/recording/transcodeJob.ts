import { buildTranscodeToH264Args } from "../media/args";
import { type H264Encoder, SOFTWARE_H264 } from "../media/encoders";
import type { FfmpegPaths } from "../media/ffmpegPaths";
import { type RunnerDeps, runFfmpeg } from "../media/runner";
import type { FinalizeResponse, TranscodeProgress } from "./contracts";
import type { PostProcessStep } from "./thumbnailPostProcess";

/**
 * Background VP9→H.264 transcode of an Electron-backend recording (SPEC §5.2).
 * Finalize never waits for it: the post-process step only enqueues the job.
 * Jobs run one at a time and report `recording:transcodeProgress`.
 *
 * The H.264 file is first written to `<stem>.h264.part.mp4`, then renamed to
 * `<stem>.h264.mp4`. When the original still exists it is swapped in place
 * (`outputPath` = the finalized `video.path`); when it has already been moved
 * (the recording flow moves media into the new project), the H.264 sibling is
 * kept and reported so the project's video source can be relinked.
 * Nothing is emitted for a video that is already H.264.
 */

export interface TranscodeJob {
  sessionId: string;
  input: string;
  fps: number;
  durationMs: number;
}

export interface TranscodeQueueDeps {
  runner: RunnerDeps;
  resolveBinaries(): FfmpegPaths | null;
  fileSize(path: string): Promise<number | null>;
  /** Best-effort delete; must not throw for a missing file. */
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  emit(progress: TranscodeProgress): void;
  /** H.264 encoder to use (hardware when probed); default libx264. */
  encoder?: (() => H264Encoder) | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface TranscodeQueue {
  enqueue(job: TranscodeJob): void;
  /** Resolves when every queued job has finished. */
  idle(): Promise<void>;
}

/** Minimum progress change between emitted events. */
export const PROGRESS_STEP = 0.01;

const MP4 = /\.mp4$/i;

const replaceExt = (path: string, suffix: string): string => path.replace(/(\.[^./\\]+)?$/, suffix);

export const h264OutputPath = (input: string): string => replaceExt(input, ".h264.mp4");
export const h264PartPath = (input: string): string => replaceExt(input, ".h264.part.mp4");

export function buildVideoCodecProbeArgs(input: string): string[] {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    input,
  ];
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createTranscodeQueue(deps: TranscodeQueueDeps): TranscodeQueue {
  const log = deps.log ?? (() => {});
  let tail: Promise<void> = Promise.resolve();

  const probeCodec = async (ffprobe: string, input: string): Promise<string | null> => {
    const res = await runFfmpeg(deps.runner, {
      bin: ffprobe,
      args: buildVideoCodecProbeArgs(input),
      collectStdout: true,
      maxStdoutBytes: 4096,
    });
    const codec = new TextDecoder().decode(res.stdout).trim().split(/\s+/)[0] ?? "";
    return codec === "" ? null : codec.toLowerCase();
  };

  const run = async (job: TranscodeJob): Promise<void> => {
    const bins = deps.resolveBinaries();
    if (!bins) {
      log("ffmpeg not found; keeping the recorded video codec");
      return;
    }
    let codec: string | null;
    try {
      codec = await probeCodec(bins.ffprobe, job.input);
    } catch (err) {
      log(`codec probe failed for ${job.input}: ${message(err)}`);
      return;
    }
    if (codec === null || codec === "h264") return;

    const part = h264PartPath(job.input);
    const final = h264OutputPath(job.input);
    let last = 0;
    const emit = (progress: number, done: boolean, outputPath: string | null, error?: string) =>
      deps.emit({
        sessionId: job.sessionId,
        progress: Math.min(1, Math.max(0, progress)),
        done,
        outputPath,
        ...(error === undefined ? {} : { error }),
      });

    emit(0, false, null);
    try {
      await runFfmpeg(deps.runner, {
        bin: bins.ffmpeg,
        args: buildTranscodeToH264Args({
          input: job.input,
          output: part,
          encoder: deps.encoder?.() ?? SOFTWARE_H264,
          fps: job.fps > 0 ? job.fps : 30,
        }),
        totalDurationMs: job.durationMs > 0 ? job.durationMs : undefined,
        onProgress: (p) => {
          if (p.ratio === null || p.done) return;
          if (p.ratio - last < PROGRESS_STEP) return;
          last = p.ratio;
          emit(Math.min(p.ratio, 0.99), false, null);
        },
      });
      const bytes = await deps.fileSize(part);
      if (bytes === null || bytes === 0) throw new Error("transcode produced no output");
      await deps.rename(part, final);
    } catch (err) {
      log(`transcode failed for ${job.input}: ${message(err)}`);
      await deps.remove(part).catch(() => {});
      emit(last, true, null, message(err));
      return;
    }

    let outputPath = final;
    // Only swap into an .mp4 name: a WebM left behind by a failed remux must not end up
    // holding an MP4 container, so its H.264 sibling is reported instead.
    if (MP4.test(job.input) && (await deps.exists(job.input))) {
      try {
        await deps.remove(job.input);
        await deps.rename(final, job.input);
        outputPath = job.input;
      } catch (err) {
        // The H.264 sibling is intact; report it instead of the swap.
        log(`in-place swap failed for ${job.input}: ${message(err)}`);
      }
    }
    emit(1, true, outputPath);
  };

  return {
    enqueue: (job) => {
      tail = tail.then(() => run(job)).catch((err: unknown) => log(message(err)));
    },
    idle: () => tail,
  };
}

/**
 * Post-process step that queues the background transcode for Electron-backend
 * recordings (native helpers already write H.264) and returns immediately.
 */
export function createTranscodePostProcess(queue: TranscodeQueue): PostProcessStep {
  return async (res: FinalizeResponse) => {
    if (res.meta.backend === "electron") {
      queue.enqueue({
        sessionId: res.recordingId,
        input: res.video.path,
        fps: res.meta.recordedFps,
        durationMs: res.meta.durationMs,
      });
    }
    return res;
  };
}
