import { type PermissionsSnapshot, snapshotsEqual } from "./permissionModel";

/** Poll interval while the onboarding permissions screen is open (§11). */
export const PERMISSION_POLL_MS = 2000;

export interface IntervalTimer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PermissionPollingOptions {
  read: () => PermissionsSnapshot | Promise<PermissionsSnapshot>;
  /** Called with the first snapshot and then only when it changes. */
  onChange: (snapshot: PermissionsSnapshot) => void;
  timer: IntervalTimer;
  intervalMs?: number | undefined;
}

/**
 * Start polling. Reads immediately, then every `intervalMs`; a read still in
 * flight skips the tick (no overlap). Read errors are swallowed and retried
 * next tick. Returns `stop()`; nothing is emitted after stop.
 */
export function startPermissionPolling(opts: PermissionPollingOptions): () => void {
  let last: PermissionsSnapshot | null = null;
  let inFlight = false;
  let stopped = false;

  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const snap = await opts.read();
      if (stopped) return;
      if (last === null || !snapshotsEqual(last, snap)) {
        last = snap;
        opts.onChange(snap);
      }
    } catch {
      // transient OS query failure; retry on next tick
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const handle = opts.timer.setInterval(() => void tick(), opts.intervalMs ?? PERMISSION_POLL_MS);
  return () => {
    if (stopped) return;
    stopped = true;
    opts.timer.clearInterval(handle);
  };
}
