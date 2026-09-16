import * as path from "node:path";
import { proxyArgs } from "../media/args";
import type { ProbeResult } from "../media/probe";
import { runFfmpeg } from "../media/runner";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import {
  type FfmpegDeps,
  causeCode,
  probeVideo,
  requireFfmpeg,
  resolveVideoSource,
} from "./mediaTools";
import { CACHE_DIR } from "./paths";

/**
 * Background 1080p preview proxy (§6.3) for sources above 1440p or longer than
 * 30 minutes. Preview uses `cache/proxy.mp4`; export always uses the original.
 */

/** Project-relative (posix) proxy location. */
export const PROXY_REL_PATH = `${CACHE_DIR}/proxy.mp4`;
export const PROXY_TEMP_NAME = "proxy.partial.mp4";
export const PROXY_MIN_SHORT_EDGE = 1440;
export const PROXY_MIN_DURATION_MS = 30 * 60_000;

export function needsProxy(probe: Pick<ProbeResult, "width" | "height" | "durationMs">): boolean {
  return (
    Math.min(probe.width, probe.height) > PROXY_MIN_SHORT_EDGE ||
    probe.durationMs > PROXY_MIN_DURATION_MS
  );
}

export interface ProxyProgressEvent {
  projectId: string;
  /** 0..1 */
  progress: number;
}

export interface ProxyDeps {
  fs: FsLike;
  ffmpeg?: FfmpegDeps | undefined;
  onProgress?: ((e: ProxyProgressEvent) => void) | undefined;
}

export interface EnsureProxyResult {
  /** Project-relative (posix), or null when the source needs no proxy. */
  proxyPath: string | null;
  generated: boolean;
}

/** Smallest progress step worth a push event. */
const PROGRESS_STEP = 0.01;

export function createProxyService(deps: ProxyDeps) {
  const { fs } = deps;
  const inflight = new Map<string, Promise<EnsureProxyResult>>();

  const run = async (dir: string, projectId: string): Promise<EnsureProxyResult> => {
    const ff = requireFfmpeg(deps.ffmpeg);
    const src = await resolveVideoSource(fs, dir);
    let probe: ProbeResult;
    try {
      probe = await probeVideo(ff, src.abs);
    } catch (err) {
      throw new FsIpcError("PROXY_FAILED", "Could not read the video source", {
        cause: causeCode(err),
      });
    }
    if (!needsProxy(probe)) return { proxyPath: null, generated: false };

    const cacheDir = path.join(dir, CACHE_DIR);
    const proxyAbs = path.join(cacheDir, path.basename(PROXY_REL_PATH));
    const existing = await fs.stat(proxyAbs).catch(() => null);
    if (existing?.isFile() && existing.size > 0 && existing.mtimeMs >= src.mtimeMs) {
      return { proxyPath: PROXY_REL_PATH, generated: false };
    }

    await fs.mkdir(cacheDir, { recursive: true });
    const tempPath = path.join(cacheDir, PROXY_TEMP_NAME);
    let last = -1;
    const report = (progress: number): void => {
      const p = Math.min(1, Math.max(0, progress));
      if (p < 1 && p - last < PROGRESS_STEP) return;
      last = p;
      deps.onProgress?.({ projectId, progress: p });
    };
    report(0);
    try {
      await runFfmpeg(ff.runner, {
        bin: ff.bins.ffmpeg,
        args: proxyArgs({ input: src.abs, output: tempPath }),
        totalDurationMs: probe.durationMs,
        onProgress: (p) => {
          if (p.ratio !== null) report(p.ratio);
        },
      });
      await fs.rename(tempPath, proxyAbs);
    } catch (err) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw new FsIpcError("PROXY_FAILED", "Could not generate the preview proxy", {
        cause: causeCode(err) ?? errnoCode(err),
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (last < 1) report(1);
    return { proxyPath: PROXY_REL_PATH, generated: true };
  };

  return {
    /** Concurrent calls for one project share a single ffmpeg job. */
    ensure(dir: string, projectId: string): Promise<EnsureProxyResult> {
      const pending = inflight.get(dir);
      if (pending) return pending;
      const p = run(dir, projectId).finally(() => inflight.delete(dir));
      inflight.set(dir, p);
      return p;
    },
  };
}

export type ProxyService = ReturnType<typeof createProxyService>;
