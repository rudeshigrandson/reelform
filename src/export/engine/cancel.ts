/** Cancellation helpers shared by the export engine (§10.7). */

export class ExportCancelledError extends Error {
  override name = "AbortError";
  constructor() {
    super("Export cancelled");
  }
}

export function throwIfAborted(signal?: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ExportCancelledError();
}

export function isCancelled(e: unknown): e is ExportCancelledError {
  return e instanceof ExportCancelledError;
}

/**
 * Tiny change notifier: async loops `await wait()` and event callbacks
 * (`dequeue`, `output`, `error`, abort) call `pulse()` to wake them.
 */
export class Pulse {
  private waiters: (() => void)[] = [];

  pulse = (): void => {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  };

  wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
