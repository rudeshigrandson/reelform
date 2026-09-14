import { create } from "zustand";
import { type RateFn, advance, clampTime, scaleRate, stepFrames, stepSeconds } from "./clock";

/**
 * Playhead store (ENGINEERING_SPEC §6.2). Lives apart from the project document:
 * updated every animation frame, never through commands / undo history.
 */

/** Shuttle multipliers reachable with L (each press doubles up to the max). */
export const SHUTTLE_RATES = [1, 2, 4] as const;

export interface PlaybackData {
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  loop: boolean;
  fps: number;
  /**
   * J/K/L shuttle multiplier applied on top of speed regions: 0 when paused,
   * 1/2/4 while playing forward. Reverse playback is out of scope for 1.0 —
   * J pauses and steps back one second per press instead.
   */
  shuttleRate: number;
}

export interface PlaybackState extends PlaybackData {
  seek: (ms: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setLoop: (loop: boolean) => void;
  setDuration: (ms: number) => void;
  setFps: (fps: number) => void;
  stepFrame: (n: number) => void;
  stepSecond: (n: number) => void;
  skipToStart: () => void;
  skipToEnd: () => void;
  /** J: pause and step back 1s (reverse playback out of scope). */
  shuttleBack: () => void;
  /** K: pause. */
  shuttleStop: () => void;
  /** L: play at 1×, or double the shuttle rate (max 4×) while already playing. */
  shuttleForward: () => void;
  /** Advance by wall-clock ms; `rateAt` supplies speed-region rates. */
  tick: (elapsedWallMs: number, rateAt?: RateFn | undefined) => void;
  reset: () => void;
}

export function initialPlaybackState(): PlaybackData {
  return {
    currentMs: 0,
    durationMs: 0,
    isPlaying: false,
    loop: false,
    fps: 30,
    shuttleRate: 0,
  };
}

export const usePlaybackStore = create<PlaybackState>((set, get) => {
  const startPlaying = (rate: number): void => {
    const { durationMs, currentMs } = get();
    if (durationMs <= 0) return;
    set({
      isPlaying: true,
      shuttleRate: rate,
      currentMs: currentMs >= durationMs ? 0 : currentMs,
    });
  };
  const stop = (): void => set({ isPlaying: false, shuttleRate: 0 });

  return {
    ...initialPlaybackState(),
    seek: (ms) => set({ currentMs: clampTime(ms, get().durationMs) }),
    play: () => startPlaying(1),
    pause: stop,
    toggle: () => (get().isPlaying ? stop() : startPlaying(1)),
    setLoop: (loop) => set({ loop }),
    setDuration: (ms) => {
      const durationMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
      const currentMs = clampTime(get().currentMs, durationMs);
      set(
        durationMs <= 0
          ? { durationMs, currentMs, isPlaying: false, shuttleRate: 0 }
          : { durationMs, currentMs },
      );
    },
    setFps: (fps) => {
      if (Number.isFinite(fps) && fps > 0) set({ fps });
    },
    stepFrame: (n) => {
      const { currentMs, fps, durationMs } = get();
      set({ currentMs: stepFrames(currentMs, n, fps, durationMs) });
    },
    stepSecond: (n) => {
      const { currentMs, durationMs } = get();
      set({ currentMs: stepSeconds(currentMs, n, durationMs) });
    },
    skipToStart: () => set({ currentMs: 0 }),
    skipToEnd: () => set({ currentMs: get().durationMs }),
    shuttleBack: () => {
      const { currentMs, durationMs } = get();
      set({ isPlaying: false, shuttleRate: 0, currentMs: stepSeconds(currentMs, -1, durationMs) });
    },
    shuttleStop: stop,
    shuttleForward: () => {
      const { isPlaying, shuttleRate } = get();
      if (!isPlaying) return startPlaying(1);
      const next =
        SHUTTLE_RATES.find((r) => r > shuttleRate) ?? SHUTTLE_RATES[SHUTTLE_RATES.length - 1];
      set({ shuttleRate: next ?? 1 });
    },
    tick: (elapsedWallMs, rateAt) => {
      const s = get();
      if (!s.isPlaying) return;
      const factor = s.shuttleRate > 0 ? s.shuttleRate : 1;
      const base: RateFn = rateAt ?? (() => 1);
      const next = advance(s, elapsedWallMs, scaleRate(base, factor));
      if (next.currentMs === s.currentMs && next.isPlaying === s.isPlaying) return;
      set(next.isPlaying ? { currentMs: next.currentMs } : { ...next, shuttleRate: 0 });
    },
    reset: () => set(initialPlaybackState()),
  };
});
