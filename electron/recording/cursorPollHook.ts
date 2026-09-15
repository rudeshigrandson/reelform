import type { Timers } from "../capture/helperProcess";
import type { InputHook, InputHookEvents } from "./telemetry";

/**
 * Cursor-position-only {@link InputHook} for the Electron capture backend,
 * which has no native cursor monitor (§5.2). Polls an injected
 * `getCursorPoint` (Electron: `screen.getCursorScreenPoint()`, DIP — the same
 * space as display bounds) at `sampleHz` and emits `mousemove` when the
 * position changes. It never produces clicks, keys or scrolls, so it cannot
 * record typing at all (§9.7 / §13 privacy hold trivially).
 *
 * This is a fallback: the orchestrator should inject uiohook-napi
 * (Windows/Linux) or the `reelform-cursor-monitor` bridge (macOS) through
 * `RecordingMainOptions.inputHook` once those are wired; an injected hook
 * replaces this one entirely.
 *
 * Polling runs only while at least one `mousemove` listener is subscribed (the
 * telemetry collector subscribes while recording and unsubscribes on stop).
 */

export interface CursorPollHookOptions {
  getCursorPoint(): { x: number; y: number };
  timers: Timers;
  sampleHz?: number | undefined;
}

export const DEFAULT_CURSOR_POLL_HZ = 120;

export function createCursorPollHook(opts: CursorPollHookOptions): InputHook {
  const hz =
    opts.sampleHz !== undefined && Number.isFinite(opts.sampleHz) && opts.sampleHz > 0
      ? opts.sampleHz
      : DEFAULT_CURSOR_POLL_HZ;
  const intervalMs = 1000 / hz;
  const moveListeners = new Set<(e: InputHookEvents["mousemove"]) => void>();
  let handle: unknown = null;
  let last: { x: number; y: number } | null = null;

  const tick = (): void => {
    handle = null;
    if (moveListeners.size === 0) return;
    let p: { x: number; y: number } | null = null;
    try {
      p = opts.getCursorPoint();
    } catch {
      // Screen API unavailable for a moment (display change); try next tick.
    }
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      if (!last || last.x !== p.x || last.y !== p.y) {
        last = { x: p.x, y: p.y };
        for (const l of [...moveListeners]) l({ x: p.x, y: p.y });
      }
    }
    handle = opts.timers.setTimeout(tick, intervalMs);
  };

  const start = (): void => {
    if (handle !== null) return;
    last = null;
    tick();
  };

  const stop = (): void => {
    if (handle !== null) opts.timers.clearTimeout(handle);
    handle = null;
  };

  return {
    on<K extends keyof InputHookEvents>(
      type: K,
      listener: (e: InputHookEvents[K]) => void,
    ): () => void {
      if (type !== "mousemove") return () => {};
      const l = listener as (e: InputHookEvents["mousemove"]) => void;
      moveListeners.add(l);
      start();
      return () => {
        moveListeners.delete(l);
        if (moveListeners.size === 0) stop();
      };
    },
  };
}
