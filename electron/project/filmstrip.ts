import * as path from "node:path";
import { filmstripArgs } from "../media/args";
import { runFfmpeg } from "../media/runner";
import { atomicWriteFile } from "./atomicWrite";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";
import { type FfmpegDeps, causeCode, requireFfmpeg, resolveVideoSource } from "./mediaTools";
import { CACHE_DIR } from "./paths";

/**
 * Timeline filmstrip thumbnails (§6.7): one JPEG every `intervalMs` of source at
 * `height` px into `cache/thumbs/`, described by `index.json` so later opens
 * reuse them until the source or the parameters change.
 */

export const THUMBS_REL_DIR = `${CACHE_DIR}/thumbs`;
export const THUMBS_INDEX = "index.json";
export const DEFAULT_THUMB_INTERVAL_MS = 2000;
export const DEFAULT_THUMB_HEIGHT = 160;
const FRAME_RE = /^\d{6}\.jpg$/;

export interface FilmstripItem {
  sourceMs: number;
  /** Project-relative (posix). */
  path: string;
}

interface FilmstripIndex {
  version: 1;
  source: { path: string; size: number; mtimeMs: number };
  intervalMs: number;
  height: number;
  count: number;
}

export interface FilmstripDeps {
  fs: FsLike;
  ffmpeg?: FfmpegDeps | undefined;
}

export interface FilmstripOptions {
  intervalMs?: number | undefined;
  height?: number | undefined;
}

const itemsFor = (count: number, intervalMs: number): FilmstripItem[] =>
  Array.from({ length: count }, (_, i) => ({
    sourceMs: i * intervalMs,
    path: `${THUMBS_REL_DIR}/${String(i + 1).padStart(6, "0")}.jpg`,
  }));

export function createFilmstripService(deps: FilmstripDeps) {
  const { fs } = deps;
  /** Per-project queue tail (never rejects). */
  const inflight = new Map<string, Promise<unknown>>();

  const frameNames = async (thumbsDir: string): Promise<string[]> =>
    (await fs.readdir(thumbsDir).catch(() => [] as string[]))
      .filter((n) => FRAME_RE.test(n))
      .sort();

  const cached = async (
    thumbsDir: string,
    want: Omit<FilmstripIndex, "version" | "count">,
  ): Promise<number | null> => {
    let index: Partial<FilmstripIndex>;
    try {
      index = JSON.parse(await fs.readFile(path.join(thumbsDir, THUMBS_INDEX), "utf8"));
    } catch {
      return null;
    }
    const s = index.source;
    const matches =
      index.version === 1 &&
      index.intervalMs === want.intervalMs &&
      index.height === want.height &&
      s?.path === want.source.path &&
      s.size === want.source.size &&
      s.mtimeMs === want.source.mtimeMs &&
      typeof index.count === "number";
    if (!matches || index.count === undefined) return null;
    const names = new Set(await frameNames(thumbsDir));
    for (const item of itemsFor(index.count, want.intervalMs)) {
      if (!names.has(path.posix.basename(item.path))) return null;
    }
    return index.count;
  };

  const run = async (dir: string, intervalMs: number, height: number) => {
    const src = await resolveVideoSource(fs, dir);
    const thumbsDir = path.join(dir, ...THUMBS_REL_DIR.split("/"));
    const want = {
      source: { path: src.stored, size: src.size, mtimeMs: src.mtimeMs },
      intervalMs,
      height,
    };
    const hit = await cached(thumbsDir, want);
    if (hit !== null) return { items: itemsFor(hit, intervalMs) };

    const ff = requireFfmpeg(deps.ffmpeg);
    try {
      await fs.rm(thumbsDir, { recursive: true, force: true });
      await fs.mkdir(thumbsDir, { recursive: true });
      await runFfmpeg(ff.runner, {
        bin: ff.bins.ffmpeg,
        args: filmstripArgs({
          input: src.abs,
          outputDir: thumbsDir,
          intervalMs,
          height,
          join: path.join,
        }),
      });
      const names = await frameNames(thumbsDir);
      // ffmpeg numbers from 1 without gaps; anything else means a partial write.
      const count = names.every((n, i) => n === `${String(i + 1).padStart(6, "0")}.jpg`)
        ? names.length
        : 0;
      if (count === 0) throw new Error("ffmpeg produced no thumbnails");
      const index: FilmstripIndex = { version: 1, ...want, count };
      await atomicWriteFile(fs, path.join(thumbsDir, THUMBS_INDEX), JSON.stringify(index));
      return { items: itemsFor(count, intervalMs) };
    } catch (err) {
      await fs.rm(thumbsDir, { recursive: true, force: true }).catch(() => undefined);
      throw new FsIpcError("THUMBNAILS_FAILED", "Could not generate timeline thumbnails", {
        cause: causeCode(err) ?? errnoCode(err),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    ensure(dir: string, opts: FilmstripOptions = {}): Promise<{ items: FilmstripItem[] }> {
      const intervalMs = opts.intervalMs ?? DEFAULT_THUMB_INTERVAL_MS;
      const height = opts.height ?? DEFAULT_THUMB_HEIGHT;
      // One job per project: a second request with other params waits, then reuses or regenerates.
      const prev = inflight.get(dir);
      const p = (prev ? prev.catch(() => undefined) : Promise.resolve()).then(() =>
        run(dir, intervalMs, height),
      );
      // The queue tail never rejects; the caller handles `p`'s failure.
      const tail: Promise<unknown> = p
        .catch(() => undefined)
        .then(() => {
          if (inflight.get(dir) === tail) inflight.delete(dir);
        });
      inflight.set(dir, tail);
      return p;
    },
  };
}

export type FilmstripService = ReturnType<typeof createFilmstripService>;
