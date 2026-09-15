import { CaptionsError } from "./errors";

/**
 * Runs `whisper-cli` for one WAV chunk. Spawn is injected; never uses a shell
 * (args are an array). Progress comes from `--print-progress` lines on stderr
 * (`whisper_print_progress_callback: progress =  45%`).
 */

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

export interface WhisperArgsOptions {
  modelPath: string;
  wavPath: string;
  /** Output path without extension; whisper writes `<outBase>.json`. */
  outBase: string;
  /** Whisper language code or "auto". */
  language: string;
  threads?: number | undefined;
}

export function buildWhisperArgs(o: WhisperArgsOptions): string[] {
  const args = [
    "-m",
    o.modelPath,
    "-f",
    o.wavPath,
    "-l",
    o.language,
    "--output-json-full",
    "-of",
    o.outBase,
    "--print-progress",
  ];
  if (o.threads !== undefined && Number.isInteger(o.threads) && o.threads > 0) {
    args.push("-t", String(o.threads));
  }
  return args;
}

const PROGRESS_RE = /progress\s*=\s*(\d{1,3})%/g;

/** Latest progress percentage (0–1) found in a stderr chunk, or null. */
export function parseWhisperProgress(text: string): number | null {
  let last: number | null = null;
  for (const m of text.matchAll(PROGRESS_RE)) {
    if (m[1] !== undefined) last = Math.min(100, Number(m[1])) / 100;
  }
  return last;
}

const STDERR_TAIL = 40;

export interface RunWhisperOptions {
  bin: string;
  args: readonly string[];
  signal?: AbortSignal | undefined;
  onProgress?: ((fraction: number) => void) | undefined;
}

export function runWhisper(spawn: SpawnFn, o: RunWhisperOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (o.signal?.aborted) {
      reject(new CaptionsError("cancelled", "Transcription cancelled"));
      return;
    }
    let child: ChildLike;
    try {
      child = spawn(o.bin, o.args);
    } catch (err) {
      reject(
        new CaptionsError("whisper-failed", "Could not start whisper-cli", { cause: String(err) }),
      );
      return;
    }
    const tail: string[] = [];
    let settled = false;
    let aborted = false;
    const decoder = new TextDecoder();
    const toText = (c: DataChunk): string => (typeof c === "string" ? c : decoder.decode(c));

    const onAbort = (): void => {
      aborted = true;
      child.kill("SIGTERM");
    };
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      o.signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };

    child.stdout?.on("data", () => undefined); // drain transcript echo
    child.stderr?.on("data", (chunk) => {
      const text = toText(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        tail.push(line);
        if (tail.length > STDERR_TAIL) tail.shift();
      }
      const p = parseWhisperProgress(text);
      if (p !== null) o.onProgress?.(p);
    });
    child.on("error", (err) =>
      finish(
        new CaptionsError("whisper-failed", "whisper-cli failed to run", { cause: String(err) }),
      ),
    );
    child.on("close", (code, signal) => {
      if (aborted) return finish(new CaptionsError("cancelled", "Transcription cancelled"));
      if (code === 0) return finish(null);
      finish(
        new CaptionsError("whisper-failed", `whisper-cli exited with ${code ?? signal}`, {
          code,
          signal,
          stderr: tail.join("\n"),
        }),
      );
    });
  });
}
