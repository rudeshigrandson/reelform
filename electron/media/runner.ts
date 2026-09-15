import { MediaError } from "./errors";
import { type FfmpegProgress, createProgressParser } from "./progress";

/**
 * Child-process runner for ffmpeg / ffprobe. Spawn, timers and the abort signal
 * are injected so it runs under vitest with a fake child. Never uses a shell
 * (§13): args are passed as an array.
 */

/** Fixed-capacity FIFO keeping only the newest items (stderr tail for error reports). */
export class RingBuffer<T> {
  private readonly items: T[] = [];
  constructor(readonly capacity: number) {
    if (!(capacity >= 1)) throw new RangeError("RingBuffer capacity must be ≥ 1");
  }
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }
  toArray(): T[] {
    return [...this.items];
  }
  get size(): number {
    return this.items.length;
  }
}

type DataChunk = string | Uint8Array;

interface Readable {
  on(event: "data", cb: (chunk: DataChunk) => void): unknown;
}

/** The subset of `ChildProcess` the runner uses. */
export interface ChildLike {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close", cb: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: NodeJS.Signals | undefined): boolean;
}

export type SpawnFn = (command: string, args: readonly string[]) => ChildLike;

export interface RunnerDeps {
  spawn: SpawnFn;
  setTimeout?: ((cb: () => void, ms: number) => unknown) | undefined;
  clearTimeout?: ((handle: unknown) => void) | undefined;
}

export interface RunOptions {
  bin: string;
  args: readonly string[];
  signal?: AbortSignal | undefined;
  /** Parse stdout as `-progress pipe:1` output. */
  onProgress?: ((p: FfmpegProgress) => void) | undefined;
  totalDurationMs?: number | undefined;
  /** Buffer stdout bytes (probe JSON, thumbnail PNG). */
  collectStdout?: boolean | undefined;
  maxStdoutBytes?: number | undefined;
  stderrLines?: number | undefined;
  /** SIGTERM → SIGKILL escalation delay on cancel. */
  killGraceMs?: number | undefined;
}

export interface RunResult {
  stdout: Uint8Array;
  stderrTail: string[];
}

export const DEFAULT_STDERR_LINES = 50;
export const DEFAULT_MAX_STDOUT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_KILL_GRACE_MS = 2000;

const decoder = () => new TextDecoder();
const toBytes = (c: DataChunk): Uint8Array =>
  typeof c === "string" ? new TextEncoder().encode(c) : c;

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function runFfmpeg(deps: RunnerDeps, opts: RunOptions): Promise<RunResult> {
  const setT = deps.setTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
  const clearT =
    deps.clearTimeout ??
    ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
  const stderr = new RingBuffer<string>(opts.stderrLines ?? DEFAULT_STDERR_LINES);
  const maxStdout = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;

  return new Promise<RunResult>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new MediaError("FFMPEG_CANCELLED", "Cancelled before start"));
      return;
    }

    let child: ChildLike;
    try {
      child = deps.spawn(opts.bin, opts.args);
    } catch (err) {
      reject(new MediaError("FFMPEG_SPAWN_FAILED", `Could not start ${opts.bin}`, String(err)));
      return;
    }

    let settled = false;
    let cancelled = false;
    let overflow = false;
    let killTimer: unknown = null;
    const outChunks: Uint8Array[] = [];
    let outBytes = 0;
    const progress = opts.onProgress
      ? createProgressParser(opts.onProgress, opts.totalDurationMs)
      : null;
    const outText = decoder();
    const errText = decoder();
    let errPending = "";

    let terminating = false;
    const terminate = (): void => {
      // Overflow and abort can both ask; one SIGTERM and one escalation timer only.
      if (terminating) return;
      terminating = true;
      child.kill("SIGTERM");
      killTimer = setT(() => {
        if (!settled) child.kill("SIGKILL");
      }, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    };

    const onAbort = (): void => {
      if (settled || cancelled) return;
      cancelled = true;
      terminate();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (killTimer !== null) clearT(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    child.stdout?.on("data", (chunk) => {
      if (progress)
        progress.push(typeof chunk === "string" ? chunk : outText.decode(chunk, { stream: true }));
      if (!opts.collectStdout || overflow) return;
      const bytes = toBytes(chunk);
      outBytes += bytes.byteLength;
      if (outBytes > maxStdout) {
        overflow = true;
        terminate();
        return;
      }
      outChunks.push(bytes);
    });

    child.stderr?.on("data", (chunk) => {
      errPending += typeof chunk === "string" ? chunk : errText.decode(chunk, { stream: true });
      const lines = errPending.split(/\r?\n|\r/);
      errPending = lines.pop() ?? "";
      for (const l of lines) if (l.trim() !== "") stderr.push(l);
    });

    child.on("error", (err) => {
      finish(() =>
        reject(
          new MediaError("FFMPEG_SPAWN_FAILED", `Could not start ${opts.bin}: ${err.message}`),
        ),
      );
    });

    child.on("close", (code, signal) => {
      progress?.end();
      if (errPending.trim() !== "") stderr.push(errPending);
      errPending = "";
      const stderrTail = stderr.toArray();
      finish(() => {
        if (cancelled) {
          reject(new MediaError("FFMPEG_CANCELLED", "Cancelled", { stderrTail }));
        } else if (overflow) {
          reject(new MediaError("FFMPEG_OUTPUT_TOO_LARGE", `stdout exceeded ${maxStdout} bytes`));
        } else if (code === 0) {
          resolve({ stdout: concat(outChunks, outBytes), stderrTail });
        } else {
          reject(
            new MediaError("FFMPEG_FAILED", `${opts.bin} exited with ${code ?? signal}`, {
              exitCode: code,
              signal,
              stderrTail,
            }),
          );
        }
      });
    });
  });
}
