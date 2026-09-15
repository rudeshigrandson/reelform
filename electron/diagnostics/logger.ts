import type { Scrubber } from "./scrub";

/**
 * Main-process logger: levels, scrubbed messages, in-memory ring buffer of the
 * last N entries for "Copy diagnostics" (S24 About / Advanced log level).
 * Clock and sink are injected; nothing here touches the filesystem.
 */

export const LOG_LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LOG_LEVEL_ORDER;

export interface LogEntry {
  /** Epoch ms from the injected clock. */
  t: number;
  level: LogLevel;
  scope: string;
  message: string;
}

export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be ≥ 1");
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    const idx = (this.start + this.count) % this.capacity;
    this.items[idx] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  /** Oldest → newest. */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push(this.items[(this.start + i) % this.capacity] as T);
    }
    return out;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.items.fill(undefined);
    this.start = 0;
    this.count = 0;
  }
}

export interface LoggerDeps {
  now: () => number;
  scrub: Scrubber;
  level?: LogLevel | undefined;
  capacity?: number | undefined;
  /** Optional passthrough (console / log file) receiving already-scrubbed entries. */
  sink?: ((entry: LogEntry) => void) | undefined;
}

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  /** Logger that shares the buffer/level but tags entries with `scope`. */
  child(scope: string): Logger;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  /** Buffered entries, oldest first. */
  entries(): LogEntry[];
  clear(): void;
}

export const DEFAULT_LOG_CAPACITY = 1000;
const MAX_MESSAGE_LENGTH = 4000;

export function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ? arg.stack : `${arg.name}: ${arg.message}`;
  if (arg === undefined) return "undefined";
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

export function createLogger(deps: LoggerDeps): Logger {
  const buffer = new RingBuffer<LogEntry>(deps.capacity ?? DEFAULT_LOG_CAPACITY);
  const shared = { level: deps.level ?? ("info" as LogLevel) };

  const make = (scope: string): Logger => {
    const write = (level: LogLevel, args: unknown[]): void => {
      if (LOG_LEVEL_ORDER[level] > LOG_LEVEL_ORDER[shared.level]) return;
      let message = deps.scrub(args.map(formatLogArg).join(" "));
      if (message.length > MAX_MESSAGE_LENGTH) message = `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
      const entry: LogEntry = { t: deps.now(), level, scope, message };
      buffer.push(entry);
      deps.sink?.(entry);
    };
    return {
      error: (...a) => write("error", a),
      warn: (...a) => write("warn", a),
      info: (...a) => write("info", a),
      debug: (...a) => write("debug", a),
      child: (s) => make(scope ? `${scope}:${s}` : s),
      setLevel: (l) => {
        shared.level = l;
      },
      getLevel: () => shared.level,
      entries: () => buffer.toArray(),
      clear: () => buffer.clear(),
    };
  };
  return make("");
}

/** One-line text form: `2026-09-14T10:00:00.000Z WARN [export] message`. */
export function formatLogEntry(e: LogEntry): string {
  const scope = e.scope ? ` [${e.scope}]` : "";
  return `${new Date(e.t).toISOString()} ${e.level.toUpperCase()}${scope} ${e.message}`;
}
