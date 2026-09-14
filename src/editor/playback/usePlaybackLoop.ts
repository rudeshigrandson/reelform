import { useEffect, useRef } from "react";
import type { RateFn } from "./clock";
import { usePlaybackStore } from "./store";

export interface PlaybackLoopOptions {
  /** Speed-region rate function (see `rateAtFromRegions`). Defaults to 1×. */
  rateAt?: RateFn | undefined;
  raf?: ((cb: FrameRequestCallback) => number) | undefined;
  caf?: ((id: number) => void) | undefined;
  now?: (() => number) | undefined;
}

/**
 * Drives the playback store from `requestAnimationFrame` while `isPlaying`.
 * Each frame calls `tick(now - last, rateAt)`. Cancels on pause and unmount.
 * `raf`/`caf`/`now` are injectable so tests can step frames deterministically.
 */
export function usePlaybackLoop(options: PlaybackLoopOptions = {}): void {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const rateRef = useRef<RateFn | undefined>(options.rateAt);
  rateRef.current = options.rateAt;

  const raf = options.raf;
  const caf = options.caf;
  const now = options.now;

  useEffect(() => {
    if (!isPlaying) return;
    const request = raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
    const cancel = caf ?? ((id: number) => cancelAnimationFrame(id));
    const clock = now ?? (() => performance.now());

    let last = clock();
    let id: number | null = null;
    let active = true;

    const frame = (): void => {
      id = null;
      if (!active) return;
      const t = clock();
      usePlaybackStore.getState().tick(t - last, rateRef.current);
      last = t;
      if (active && usePlaybackStore.getState().isPlaying) id = request(frame);
    };
    id = request(frame);

    return () => {
      active = false;
      if (id !== null) cancel(id);
    };
  }, [isPlaying, raf, caf, now]);
}
