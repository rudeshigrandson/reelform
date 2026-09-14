import * as nodePath from "node:path";
import type { PathOps } from "./roots";

/**
 * Locate the ffmpeg / ffprobe binaries (ENGINEERING_SPEC §0: ffmpeg-static +
 * ffprobe-static bundled with `asarUnpack`). Pure: every filesystem and process
 * fact is injected so all layouts are testable without the packages installed.
 *
 * Candidate order: explicit env override → bundled package (inside
 * `app.asar.unpacked` when packaged) → `PATH` lookup.
 */

export type Platform = "darwin" | "win32" | "linux" | (string & {});

export interface FfmpegPathDeps {
  platform: Platform;
  arch: string;
  /** `app.getAppPath()` — `…/resources/app.asar` when packaged, repo root in dev. */
  appPath: string;
  env: Readonly<Record<string, string | undefined>>;
  exists(p: string): boolean;
  path?: (PathOps & { delimiter: string }) | undefined;
}

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

const exe = (platform: Platform, name: string): string =>
  platform === "win32" ? `${name}.exe` : name;

/** Map a path inside `app.asar` to its unpacked twin (binaries cannot run from an archive). */
export function toAsarUnpacked(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/]|$)/, "$1app.asar.unpacked$2");
}

function pathDirs(deps: FfmpegPathDeps, delimiter: string): string[] {
  const raw = deps.env.PATH ?? deps.env.Path ?? "";
  return raw.split(delimiter).filter((d) => d !== "");
}

/** Every location checked for `tool`, in priority order. */
export function binaryCandidates(deps: FfmpegPathDeps, tool: "ffmpeg" | "ffprobe"): string[] {
  const path = deps.path ?? nodePath;
  const delimiter = deps.path?.delimiter ?? (deps.platform === "win32" ? ";" : ":");
  const name = exe(deps.platform, tool);
  const out: string[] = [];

  const override = deps.env[tool === "ffmpeg" ? "REELFORM_FFMPEG_PATH" : "REELFORM_FFPROBE_PATH"];
  if (override) out.push(override);

  const modules = path.join(deps.appPath, "node_modules");
  const bundled =
    tool === "ffmpeg"
      ? path.join(modules, "ffmpeg-static", name)
      : path.join(modules, "ffprobe-static", "bin", deps.platform, deps.arch, name);
  const unpacked = toAsarUnpacked(bundled);
  out.push(unpacked);
  if (unpacked !== bundled) out.push(bundled);

  for (const dir of pathDirs(deps, delimiter)) out.push(path.join(dir, name));
  return out;
}

/** First existing binary for each tool; null when either is missing. */
export function resolveFfmpegPaths(deps: FfmpegPathDeps): FfmpegPaths | null {
  const ffmpeg = binaryCandidates(deps, "ffmpeg").find((p) => deps.exists(p));
  const ffprobe = binaryCandidates(deps, "ffprobe").find((p) => deps.exists(p));
  return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
}
