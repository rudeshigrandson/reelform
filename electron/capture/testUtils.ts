import { setImmediate } from "node:timers";
import type {
  HelperChild,
  HelperDeps,
  HelperMessage,
  Readable,
  SpawnOptions,
  Timers,
} from "./helperProcess";

/** Shared test fixtures for capture + recording harness tests (not exported from the barrel). */

export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

interface Task {
  at: number;
  cb: () => void;
}

/** Deterministic injected timers with a virtual clock. */
export class FakeTimers implements Timers {
  now = 0;
  private seq = 0;
  private readonly tasks = new Map<number, Task>();

  setTimeout(cb: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + Math.max(0, ms), cb });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.tasks.delete(handle);
  }

  get pendingCount(): number {
    return this.tasks.size;
  }

  private nextDue(end: number): [number, Task] | null {
    let best: [number, Task] | null = null;
    for (const e of this.tasks) {
      if (e[1].at > end) continue;
      if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0])) best = e;
    }
    return best;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (let d = this.nextDue(end); d; d = this.nextDue(end)) {
      this.tasks.delete(d[0]);
      this.now = d[1].at;
      d[1].cb();
    }
    this.now = end;
  }

  /** Like `advance`, draining microtasks/immediates after each fired timer. */
  async advanceAsync(ms: number): Promise<void> {
    await flush();
    const end = this.now + ms;
    for (let d = this.nextDue(end); d; d = this.nextDue(end)) {
      this.tasks.delete(d[0]);
      this.now = d[1].at;
      d[1].cb();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

class FakeStream implements Readable {
  private readonly listeners: ((chunk: string | Uint8Array) => void)[] = [];
  on(_event: "data", listener: (chunk: string | Uint8Array) => void): this {
    this.listeners.push(listener);
    return this;
  }
  push(chunk: string | Uint8Array): void {
    for (const l of this.listeners) l(chunk);
  }
}

type ExitListener = (code: number | null, signal: string | null) => void;

export class FakeChild implements HelperChild {
  readonly written: HelperMessage[] = [];
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  onWrite: ((msg: HelperMessage, child: FakeChild) => void) | null = null;
  private readonly exitListeners: ExitListener[] = [];
  private readonly errorListeners: ((err: Error) => void)[] = [];

  constructor(readonly pid: number | undefined = 4242) {}

  readonly stdin = {
    write: (data: string): boolean => {
      for (const line of data.split("\n")) {
        if (!line) continue;
        const msg = JSON.parse(line) as HelperMessage;
        this.written.push(msg);
        this.onWrite?.(msg, this);
      }
      return true;
    },
  };

  on(event: "exit", listener: ExitListener): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "exit" | "error", listener: ExitListener | ((err: Error) => void)): this {
    if (event === "exit") this.exitListeners.push(listener as ExitListener);
    else this.errorListeners.push(listener as (err: Error) => void);
    return this;
  }

  reply(msg: object): void {
    this.stdout.push(`${JSON.stringify(msg)}\n`);
  }

  exit(code: number | null = 1, signal: string | null = null): void {
    for (const l of this.exitListeners) l(code, signal);
  }

  error(err: Error): void {
    for (const l of this.errorListeners) l(err);
  }
}

export interface HelperScript {
  version?: string;
  caps?: string[];
  silentPing?: boolean;
  firstFramePtsNs?: number | string;
  failStart?: boolean;
  stopPaths?: Record<string, string>;
  sources?: { displays: unknown[]; windows: unknown[] };
}

/** Auto-responder implementing the helper protocol (§5.5). */
export function scriptHelper(child: FakeChild, s: HelperScript = {}): void {
  child.onWrite = (m, c) => {
    switch (m.t) {
      case "ping":
        if (!s.silentPing)
          c.reply({ t: "pong", version: s.version ?? "1.0.0", caps: s.caps ?? ["capture"] });
        return;
      case "start":
        if (s.failStart) {
          c.reply({ t: "error", id: m.id, code: "SCK_DENIED", message: "denied" });
        } else {
          c.reply({ t: "ready", id: m.id });
          c.reply({ t: "started", firstFramePtsNs: s.firstFramePtsNs ?? "123456789" });
        }
        return;
      case "pause":
      case "resume":
        c.reply({ t: "ok", id: m.id });
        return;
      case "stop":
        c.reply({ t: "stopped", id: m.id, durationMs: 1234, paths: s.stopPaths ?? {} });
        return;
      case "discard":
        c.reply({ t: "discarded", id: m.id });
        return;
      case "listSources":
        c.reply({ t: "sources", id: m.id, ...(s.sources ?? { displays: [], windows: [] }) });
        return;
    }
  };
}

export interface FakeHelperEnv {
  deps: HelperDeps;
  timers: FakeTimers;
  children: FakeChild[];
  spawns: { command: string; args: readonly string[]; options: SpawnOptions }[];
  killed: number[];
}

export function fakeHelperEnv(
  onSpawn: (child: FakeChild) => void = (c) => scriptHelper(c),
): FakeHelperEnv {
  const timers = new FakeTimers();
  const env: FakeHelperEnv = {
    timers,
    children: [],
    spawns: [],
    killed: [],
    deps: {
      timers,
      spawn: (command, args, options) => {
        env.spawns.push({ command, args, options });
        const child = new FakeChild();
        env.children.push(child);
        onSpawn(child);
        return child;
      },
      killTree: (pid) => {
        env.killed.push(pid);
      },
    },
  };
  return env;
}
