/**
 * Native helper child process (ENGINEERING_SPEC §5.5).
 *
 * Stdio, UTF-8, one JSON object per line: `{ t, id?, ...payload }`. Main owns
 * helpers: spawn with `windowsHide` (no shell), ping/pong handshake within a
 * 12s start timeout, request/response correlation by `id`, a watchdog that
 * kills a silent helper, kill-tree on exit, and a stderr ring buffer for
 * diagnostics. Every side effect (spawn, kill, timers) is injected.
 */

export const START_TIMEOUT_MS = 12_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/** Helpers emit `stats` every 1s while capturing; 5 silent seconds = hung. */
export const DEFAULT_WATCHDOG_MS = 5_000;
export const DEFAULT_STDERR_LINES = 200;

export interface HelperMessage {
  t: string;
  id?: number | undefined;
  [key: string]: unknown;
}

export interface Readable {
  on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown;
}

export interface HelperChild {
  readonly pid?: number | undefined;
  readonly stdin: { write(data: string): unknown };
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface SpawnOptions {
  windowsHide: true;
  shell: false;
  stdio: ["pipe", "pipe", "pipe"];
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => HelperChild;

export interface Timers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HelperDeps {
  spawn: SpawnFn;
  /** Kill the process and all its descendants (taskkill /T on win, process group on posix). */
  killTree(pid: number): void | Promise<void>;
  timers: Timers;
}

export interface HelperOptions {
  command: string;
  args?: readonly string[] | undefined;
  startTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
  watchdogMs?: number | undefined;
  stderrLines?: number | undefined;
}

export interface Pong {
  version: string;
  caps: string[];
}

export interface ExitInfo {
  code: number | null;
  signal: string | null;
  /** True when main asked for the exit (`kill`) — otherwise it is a crash. */
  expected: boolean;
  /** Set when the watchdog or start timeout killed the helper. */
  cause?: "watchdog" | "startTimeout" | undefined;
  stderrTail: string[];
}

export class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HelperError";
  }
}

/** Fixed-capacity line ring buffer (oldest dropped first). */
export class RingBuffer {
  private readonly items: string[] = [];
  constructor(readonly capacity: number) {}
  push(line: string): void {
    if (this.capacity <= 0) return;
    this.items.push(line);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  toArray(): string[] {
    return [...this.items];
  }
}

/** Splits a byte/char stream into complete lines; keeps the partial tail. */
export class LineDecoder {
  private buf = "";
  private readonly decoder = new TextDecoder();
  push(chunk: string | Uint8Array): string[] {
    this.buf += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)).filter((l) => l.length > 0);
  }
}

/** Parse one protocol line; `null` when it is not a `{ t: string }` object. */
export function parseHelperLine(line: string): HelperMessage | null {
  try {
    const v: unknown = JSON.parse(line);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const msg = v as Record<string, unknown>;
    if (typeof msg.t !== "string") return null;
    if (msg.id !== undefined && typeof msg.id !== "number") return null;
    return msg as HelperMessage;
  } catch {
    return null;
  }
}

interface Pending {
  resolve(msg: HelperMessage): void;
  reject(err: Error): void;
  timer: unknown;
}

type State = "new" | "starting" | "running" | "exited";

export class HelperProcess {
  private child: HelperChild | null = null;
  private state: State = "new";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private pingWaiter: Pending | null = null;
  private readonly eventListeners = new Set<(msg: HelperMessage) => void>();
  private readonly exitListeners = new Set<(info: ExitInfo) => void>();
  private readonly stderr: RingBuffer;
  private expectedExit = false;
  private killCause: ExitInfo["cause"];
  private watchdogTimer: unknown = null;
  private watchdogArmed = false;
  private exitInfo: ExitInfo | null = null;

  constructor(
    private readonly opts: HelperOptions,
    private readonly deps: HelperDeps,
  ) {
    this.stderr = new RingBuffer(opts.stderrLines ?? DEFAULT_STDERR_LINES);
  }

  get running(): boolean {
    return this.state === "running";
  }

  stderrTail(): string[] {
    return this.stderr.toArray();
  }

  /** Spawn + ping. Resolves with the helper's version and capabilities. */
  start(): Promise<Pong> {
    if (this.state !== "new")
      return Promise.reject(new HelperError("HELPER_STATE", "helper already started"));
    this.state = "starting";
    let child: HelperChild;
    try {
      child = this.deps.spawn(this.opts.command, this.opts.args ?? [], {
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      this.state = "exited";
      return Promise.reject(
        new HelperError("HELPER_SPAWN_FAILED", err instanceof Error ? err.message : String(err)),
      );
    }
    this.child = child;
    const out = new LineDecoder();
    const errLines = new LineDecoder();
    child.stdout.on("data", (chunk) => {
      for (const line of out.push(chunk)) this.onLine(line);
    });
    child.stderr.on("data", (chunk) => {
      for (const line of errLines.push(chunk)) this.stderr.push(line);
    });
    child.on("exit", (code, signal) => this.handleExit(code, signal));
    child.on("error", (err) => {
      this.stderr.push(`[spawn] ${err.message}`);
      this.handleExit(null, null);
    });

    return new Promise<Pong>((resolve, reject) => {
      const timeoutMs = this.opts.startTimeoutMs ?? START_TIMEOUT_MS;
      const timer = this.deps.timers.setTimeout(() => {
        this.pingWaiter = null;
        this.killCause = "startTimeout";
        reject(
          new HelperError(
            "HELPER_START_TIMEOUT",
            `helper did not answer ping within ${timeoutMs}ms`,
          ),
        );
        void this.terminate(false);
      }, timeoutMs);
      this.pingWaiter = {
        timer,
        resolve: (msg) => {
          this.state = "running";
          resolve({
            version: typeof msg.version === "string" ? msg.version : "",
            caps: Array.isArray(msg.caps)
              ? msg.caps.filter((c): c is string => typeof c === "string")
              : [],
          });
        },
        reject,
      };
      this.write({ t: "ping" });
    });
  }

  /** Send a request and await the message that echoes its `id`. `{t:"error"}` rejects. */
  request(msg: { t: string; [key: string]: unknown }, timeoutMs?: number): Promise<HelperMessage> {
    if (this.state !== "running")
      return Promise.reject(new HelperError("HELPER_NOT_RUNNING", "helper is not running"));
    const id = this.nextId++;
    return new Promise<HelperMessage>((resolve, reject) => {
      const ms = timeoutMs ?? this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = this.deps.timers.setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HelperError(
            "HELPER_REQUEST_TIMEOUT",
            `helper did not answer "${msg.t}" within ${ms}ms`,
          ),
        );
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ ...msg, id });
    });
  }

  /** Fire-and-forget message. */
  send(msg: { t: string; [key: string]: unknown }): void {
    if (this.state === "running") this.write(msg);
  }

  /** Unsolicited messages (no matching pending id). */
  onEvent(listener: (msg: HelperMessage) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: (info: ExitInfo) => void): () => void {
    if (this.exitInfo) {
      listener(this.exitInfo);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Start killing the helper if it stays silent for `watchdogMs`. Any message resets it. */
  armWatchdog(): void {
    this.watchdogArmed = true;
    this.resetWatchdog();
  }

  disarmWatchdog(): void {
    this.watchdogArmed = false;
    if (this.watchdogTimer !== null) this.deps.timers.clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /** Expected shutdown: kill the process tree and reject pending requests. */
  kill(): Promise<void> {
    return this.terminate(true);
  }

  private async terminate(expected: boolean): Promise<void> {
    if (this.state === "exited") return;
    this.expectedExit = this.expectedExit || expected;
    this.disarmWatchdog();
    const pid = this.child?.pid;
    // Report the exit now; the OS exit event (if any) becomes a no-op.
    this.handleExit(null, "SIGKILL");
    if (pid !== undefined) {
      try {
        await this.deps.killTree(pid);
      } catch (err) {
        this.stderr.push(`[kill] ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private write(msg: object): void {
    try {
      this.child?.stdin.write(`${JSON.stringify(msg)}\n`);
    } catch (err) {
      this.stderr.push(`[stdin] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private resetWatchdog(): void {
    if (!this.watchdogArmed) return;
    if (this.watchdogTimer !== null) this.deps.timers.clearTimeout(this.watchdogTimer);
    this.watchdogTimer = this.deps.timers.setTimeout(() => {
      this.watchdogTimer = null;
      this.stderr.push("[watchdog] helper unresponsive; killing");
      this.killCause = "watchdog";
      void this.terminate(false);
    }, this.opts.watchdogMs ?? DEFAULT_WATCHDOG_MS);
  }

  private onLine(line: string): void {
    const msg = parseHelperLine(line);
    if (!msg) {
      this.stderr.push(`[protocol] ignored line: ${line.slice(0, 200)}`);
      return;
    }
    this.resetWatchdog();
    if (msg.t === "pong" && this.pingWaiter) {
      const w = this.pingWaiter;
      this.pingWaiter = null;
      this.deps.timers.clearTimeout(w.timer);
      w.resolve(msg);
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        this.deps.timers.clearTimeout(p.timer);
        if (msg.t === "error") {
          const code = typeof msg.code === "string" ? msg.code : "HELPER_ERROR";
          p.reject(
            new HelperError(code, typeof msg.message === "string" ? msg.message : "helper error"),
          );
        } else {
          p.resolve(msg);
        }
        return;
      }
    }
    for (const l of [...this.eventListeners]) l(msg);
  }

  private handleExit(code: number | null, signal: string | null): void {
    if (this.state === "exited") return;
    this.state = "exited";
    this.disarmWatchdog();
    const info: ExitInfo = {
      code,
      signal,
      expected: this.expectedExit,
      cause: this.killCause,
      stderrTail: this.stderr.toArray(),
    };
    this.exitInfo = info;
    const err = new HelperError(
      this.expectedExit ? "HELPER_KILLED" : "HELPER_EXITED",
      `helper exited (code ${code ?? "null"}, signal ${signal ?? "null"})`,
    );
    if (this.pingWaiter) {
      const w = this.pingWaiter;
      this.pingWaiter = null;
      this.deps.timers.clearTimeout(w.timer);
      w.reject(err);
    }
    for (const [id, p] of this.pending) {
      this.deps.timers.clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
    for (const l of [...this.exitListeners]) l(info);
    this.exitListeners.clear();
  }
}
