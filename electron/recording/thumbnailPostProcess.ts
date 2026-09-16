import type { FfmpegPaths } from "../media/ffmpegPaths";
import { type RunnerDeps, runFfmpeg } from "../media/runner";
import type { FinalizeResponse } from "./contracts";

/**
 * Post-stop step (SPEC §5.6, §4): render `<dir>/thumbnail.jpg` — one frame at
 * 1s, 640px wide — for the project library. The recording flow imports it into
 * the project root. Never fails finalize: without ffmpeg, or when no frame can
 * be decoded, the response is returned without `thumbnailPath`.
 */

export type PostProcessStep = (res: FinalizeResponse) => Promise<FinalizeResponse>;

export const THUMBNAIL_FILE_NAME = "thumbnail.jpg";
export const THUMBNAIL_WIDTH = 640;
/** Seek target; shorter recordings take their first frame. */
export const THUMBNAIL_SEEK_SEC = 1;

export interface ThumbnailPostProcessDeps {
  runner: RunnerDeps;
  resolveBinaries(): FfmpegPaths | null;
  log?: ((message: string) => void) | undefined;
  /** Size in bytes or null when missing; when given, an empty output counts as a failure. */
  fileSize?: ((path: string) => Promise<number | null>) | undefined;
  join?: ((...parts: string[]) => string) | undefined;
}

/** `ffmpeg -ss <s> -i <screen> -frames:v 1 -vf scale=640:-2 -q:v 3 <out>`. */
export function buildThumbnailArgs(input: string, output: string, seekSec: number): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    String(seekSec),
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    `scale=${THUMBNAIL_WIDTH}:-2`,
    "-q:v",
    "3",
    output,
  ];
}

/** Join with the separator the recording directory already uses. */
function joinLike(dir: string): (...parts: string[]) => string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return (...parts) => parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p)).join(sep);
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createThumbnailPostProcess(deps: ThumbnailPostProcessDeps): PostProcessStep {
  const log = deps.log ?? (() => {});
  return async (res) => {
    const bins = deps.resolveBinaries();
    if (!bins) {
      log("ffmpeg not found; no recording thumbnail");
      return res;
    }
    const output = (deps.join ?? joinLike(res.dir))(res.dir, THUMBNAIL_FILE_NAME);
    // A recording shorter than the seek target has no frame there; retry at 0.
    const seeks = res.meta.durationMs > THUMBNAIL_SEEK_SEC * 1000 ? [THUMBNAIL_SEEK_SEC, 0] : [0];
    for (const seek of seeks) {
      try {
        await runFfmpeg(deps.runner, {
          bin: bins.ffmpeg,
          args: buildThumbnailArgs(res.video.path, output, seek),
        });
        if (deps.fileSize) {
          const bytes = await deps.fileSize(output);
          if (bytes === null || bytes === 0) throw new Error("thumbnail produced no output");
        }
        return { ...res, thumbnailPath: output };
      } catch (err) {
        log(`thumbnail at ${seek}s failed for ${res.video.path}: ${message(err)}`);
      }
    }
    return res;
  };
}

/**
 * Run post-process steps in order, each receiving the previous result (so a
 * remux's new paths reach the thumbnail step). A step that throws is skipped
 * and the last good result carries on: post-processing never loses a recording.
 */
export function composePostProcess(
  ...steps: PostProcessStep[]
): (res: FinalizeResponse) => Promise<FinalizeResponse> {
  return async (res) => {
    let current = res;
    for (const step of steps) {
      try {
        current = { ...current, ...(await step(current)) };
      } catch {
        // Enhancement only; keep what the earlier steps produced.
      }
    }
    return current;
  };
}
