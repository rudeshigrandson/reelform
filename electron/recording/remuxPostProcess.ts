import { buildRemuxToMp4Args } from "../media/args";
import type { FfmpegPaths } from "../media/ffmpegPaths";
import { type RunnerDeps, runFfmpeg } from "../media/runner";
import type { FinalizeResponse, MediaRef } from "./contracts";

/**
 * Post-stop step for the Electron capture backend (SPEC §5.2): MediaRecorder
 * WebM files carry no duration and no seek index, so each track is remuxed with
 * `ffmpeg -c copy` into MP4 (+faststart). Stream copy is fast and lossless; a
 * VP9→H.264 transcode is a later, optional background job.
 *
 * Never loses a recording: without ffmpeg, or when a track fails, the original
 * WebM ref is kept and the partial MP4 is removed.
 */

export interface RemuxPostProcessDeps {
  runner: RunnerDeps;
  resolveBinaries(): FfmpegPaths | null;
  /** Size in bytes, or null when the file is missing. */
  fileSize(path: string): Promise<number | null>;
  /** Best-effort delete; must not throw for a missing file. */
  remove(path: string): Promise<void>;
  log?: ((message: string) => void) | undefined;
}

const TRACKS = ["video", "mic", "system", "webcam"] as const;
const WEBM = /\.webm$/i;

export function remuxedPath(path: string): string {
  return path.replace(WEBM, ".mp4");
}

export function createRemuxPostProcess(
  deps: RemuxPostProcessDeps,
): (res: FinalizeResponse) => Promise<FinalizeResponse> {
  const log = deps.log ?? (() => {});

  const remuxOne = async (ffmpeg: string, ref: MediaRef): Promise<MediaRef> => {
    if (!WEBM.test(ref.path)) return ref;
    const output = remuxedPath(ref.path);
    try {
      await runFfmpeg(deps.runner, { bin: ffmpeg, args: buildRemuxToMp4Args(ref.path, output) });
      const bytes = await deps.fileSize(output);
      if (bytes === null || bytes === 0) throw new Error("remux produced no output");
      await deps.remove(ref.path);
      return { path: output, bytes };
    } catch (err) {
      log(`remux failed for ${ref.path}: ${err instanceof Error ? err.message : String(err)}`);
      await deps.remove(output).catch(() => {});
      return ref;
    }
  };

  return async (res) => {
    const bins = deps.resolveBinaries();
    if (!bins) {
      log("ffmpeg not found; keeping WebM recordings");
      return res;
    }
    const next: FinalizeResponse = { ...res };
    // Sequential: remuxing several large tracks at once only thrashes the disk.
    for (const track of TRACKS) {
      const ref = res[track];
      if (ref) next[track] = await remuxOne(bins.ffmpeg, ref);
    }
    return next;
  };
}
