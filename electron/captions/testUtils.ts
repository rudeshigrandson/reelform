import { createHash } from "node:crypto";
import type { DownloadFs, FetchLike, FetchResponseLike, Hasher } from "./download";
import type { TranscribeFs } from "./transcribe";
import type { ChildLike, SpawnFn } from "./whisperCli";

/** Shared fakes for captions runtime tests. */

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function realHasher(): Hasher {
  const h = createHash("sha256");
  return { update: (c) => void h.update(c), digest: () => h.digest("hex") };
}

export function bytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) % 251;
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/** In-memory filesystem implementing both download and transcribe ports. */
export class MemFs implements DownloadFs, TranscribeFs {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  private tmpCounter = 0;

  async size(path: string): Promise<number | null> {
    return this.files.get(path)?.byteLength ?? null;
  }
  async *readChunks(path: string): AsyncIterable<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT ${path}`);
    for (let i = 0; i < data.byteLength; i += 1000) yield data.subarray(i, i + 1000);
  }
  async openWriter(path: string, { append }: { append: boolean }) {
    if (!append || !this.files.has(path)) this.files.set(path, new Uint8Array(0));
    return {
      write: async (chunk: Uint8Array) => {
        this.files.set(path, concat(this.files.get(path) ?? new Uint8Array(0), chunk));
      },
      close: async () => undefined,
    };
  }
  async rename(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (!data) throw new Error(`ENOENT ${from}`);
    this.files.delete(from);
    this.files.set(to, data);
  }
  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }
  async mkdtemp(prefix: string): Promise<string> {
    const dir = `${prefix}${this.tmpCounter++}`;
    this.dirs.add(dir);
    return dir;
  }
  async rm(path: string): Promise<void> {
    this.dirs.delete(path);
    for (const k of [...this.files.keys()]) if (k.startsWith(`${path}/`)) this.files.delete(k);
  }
  async readText(path: string): Promise<string> {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT ${path}`);
    return new TextDecoder().decode(data);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  writeText(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }
}

export interface FakeServerOptions {
  data: Uint8Array;
  /** Ignore Range and always answer 200 with the full body. */
  ignoreRange?: boolean;
  /** Serve only this many bytes of the body, then end (simulates a dropped connection). */
  cutAfter?: number;
  /** Throw mid-stream after this many bytes. */
  failAfter?: number;
  chunkSize?: number;
  status?: number;
  /** Called before each chunk is yielded (lets tests abort mid-stream). */
  onChunk?: (sentBytes: number) => void;
}

/** A fake HTTP server honouring `Range: bytes=N-` with 206/416. */
export function fakeServer(opts: FakeServerOptions): {
  fetch: FetchLike;
  requests: Record<string, string>[];
} {
  const requests: Record<string, string>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    requests.push(init.headers);
    if (opts.status !== undefined) return response(opts.status, {}, null);
    const total = opts.data.byteLength;
    const range = /^bytes=(\d+)-$/.exec(init.headers.Range ?? "");
    let start = 0;
    let status = 200;
    const headers: Record<string, string> = {};
    if (range?.[1] !== undefined && !opts.ignoreRange) {
      start = Number(range[1]);
      if (start >= total) return response(416, { "content-range": `bytes */${total}` }, null);
      status = 206;
      headers["content-range"] = `bytes ${start}-${total - 1}/${total}`;
      headers["content-length"] = String(total - start);
    } else {
      headers["content-length"] = String(total);
    }
    const body = opts.data.subarray(start);
    const chunkSize = opts.chunkSize ?? 4096;
    async function* stream(): AsyncIterable<Uint8Array> {
      let sent = 0;
      while (sent < body.byteLength) {
        if (opts.cutAfter !== undefined && start + sent >= opts.cutAfter) return;
        if (opts.failAfter !== undefined && start + sent >= opts.failAfter)
          throw new Error("ECONNRESET");
        opts.onChunk?.(start + sent);
        const next = body.subarray(sent, sent + chunkSize);
        sent += next.byteLength;
        yield next;
      }
    }
    return response(status, headers, stream());
  };
  return { fetch, requests };
}

function response(
  status: number,
  headers: Record<string, string>,
  body: AsyncIterable<Uint8Array> | null,
): FetchResponseLike {
  return { status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, body };
}

type Listener = (...args: never[]) => void;

/** Fake child process driven by a script. */
export class FakeChild implements ChildLike {
  private readonly listeners = new Map<string, Listener[]>();
  readonly stdout = { on: (_e: "data", _cb: (c: string | Uint8Array) => void) => this };
  readonly stderr = {
    on: (_e: "data", cb: (c: string | Uint8Array) => void) => this.add("stderr", cb as Listener),
  };
  killed: string | undefined;

  private add(event: string, cb: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return this;
  }
  on(event: "error" | "close", cb: Listener): this {
    return this.add(event, cb);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? "SIGTERM";
    queueMicrotask(() => this.emit("close", null, this.killed));
    return true;
  }
}

/**
 * Spawn fake: each call runs `script(args, child)` on the next microtask.
 * Records every invocation.
 */
export function fakeSpawn(script: (args: readonly string[], child: FakeChild) => void): {
  spawn: SpawnFn;
  calls: { bin: string; args: readonly string[]; child: FakeChild }[];
} {
  const calls: { bin: string; args: readonly string[]; child: FakeChild }[] = [];
  const spawn: SpawnFn = (bin, args) => {
    const child = new FakeChild();
    calls.push({ bin, args, child });
    queueMicrotask(() => script(args, child));
    return child;
  };
  return { spawn, calls };
}

export const argAfter = (args: readonly string[], flag: string): string => {
  const i = args.indexOf(flag);
  const v = args[i + 1];
  if (i < 0 || v === undefined) throw new Error(`missing ${flag}`);
  return v;
};
