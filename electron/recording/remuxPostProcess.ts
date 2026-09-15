import { PROGRESS_PREFIX, buildRemuxToMp4Args } from "../media/args";
import type { FfmpegPaths } from "../media/ffmpegPaths";
import { type RunnerDeps, runFfmpeg } from "../media/runner";
import type { FinalizeResponse, MediaRef } from "./contracts";

/**
 * Post-stop step for recorded tracks (SPEC §5.2):
 *
 * - Video (screen, webcam): MediaRecorder WebM carries no duration and no seek
 *   index, so it is remuxed with `ffmpeg -c copy` into MP4 (+faststart). A
 *   VP9→H.264 transcode runs later in the background (transcodeJob.ts).
 * - Audio (mic, system): MediaRecorder Opus WebM is transcoded to AAC `.m4a`
 *   (`-c:a aac -b:a 192k`) — Opus in MP4 is poorly supported by players.
 * - Mic ranges the backend could not mute live (`meta.micMutedRanges`) are
 *   silenced here, whatever the container.
 *
 * Never loses a recording: without ffmpeg, or when a track fails, the original
 * ref is kept and the partial output is removed.
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

const VIDEO_TRACKS = ["video", "webcam"] as const;
const AUDIO_TRACKS = ["mic", "system"] as const;
const WEBM = /\.webm$/i;
export const AUDIO_BITRATE = "192k";

export function remuxedPath(path: string): string {
  return path.replace(WEBM, ".mp4");
}

/** `mic.webm` → `mic.m4a`; an existing `.m4a`/`.mp4` gets a `-muted` sibling. */
export function aacPath(path: string): string {
  if (WEBM.test(path)) return path.replace(WEBM, ".m4a");
  return path.replace(/(\.[^./\\]+)?$/, "-muted.m4a");
}

/** `volume` timeline filter that silences each range (recorded ms). */
export function silenceFilter(
  ranges: readonly { startMs: number; endMs: number }[],
): string | null {
  const valid = ranges.filter((r) => Number.isFinite(r.startMs) && r.endMs > r.startMs);
  if (valid.length === 0) return null;
  const s = (ms: number) => String(Number((Math.max(0, ms) / 1000).toFixed(3)));
  const between = valid.map((r) => `between(t,${s(r.startMs)},${s(r.endMs)})`).join("+");
  return `volume=0:enable='${between}'`;
}

/** Audio-only AAC encode, optionally with an audio filter. */
export function buildAacArgs(input: string, output: string, filter: string | null): string[] {
  return [
    ...PROGRESS_PREFIX,
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    ...(filter ? ["-af", filter] : []),
    "-c:a",
    "aac",
    "-b:a",
    AUDIO_BITRATE,
    "-movflags",
    "+faststart",
    output,
  ];
}

export function createRemuxPostProcess(
  deps: RemuxPostProcessDeps,
): (res: FinalizeResponse) => Promise<FinalizeResponse> {
  const log = deps.log ?? (() => {});

  const run = async (
    ffmpeg: string,
    ref: MediaRef,
    output: string,
    args: string[],
    what: string,
  ): Promise<MediaRef> => {
    try {
      await runFfmpeg(deps.runner, { bin: ffmpeg, args });
      const bytes = await deps.fileSize(output);
      if (bytes === null || bytes === 0) throw new Error(`${what} produced no output`);
      await deps.remove(ref.path);
      return { path: output, bytes };
    } catch (err) {
      log(`${what} failed for ${ref.path}: ${err instanceof Error ? err.message : String(err)}`);
      await deps.remove(output).catch(() => {});
      return ref;
    }
  };

  return async (res) => {
    const bins = deps.resolveBinaries();
    if (!bins) {
      log("ffmpeg not found; keeping recorded tracks as written");
      return res;
    }
    const next: FinalizeResponse = { ...res };
    // Sequential: processing several large tracks at once only thrashes the disk.
    for (const track of VIDEO_TRACKS) {
      const ref = res[track];
      if (!ref || !WEBM.test(ref.path)) continue;
      const out = remuxedPath(ref.path);
      next[track] = await run(bins.ffmpeg, ref, out, buildRemuxToMp4Args(ref.path, out), "remux");
    }
    for (const track of AUDIO_TRACKS) {
      const ref = res[track];
      if (!ref) continue;
      const filter = track === "mic" ? silenceFilter(res.meta.micMutedRanges ?? []) : null;
      if (!WEBM.test(ref.path) && !filter) continue;
      const out = aacPath(ref.path);
      next[track] = await run(
        bins.ffmpeg,
        ref,
        out,
        buildAacArgs(ref.path, out, filter),
        filter ? "mic silence" : "aac transcode",
      );
    }
    return next;
  };
}
