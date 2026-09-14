import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { rateAtFromRegions } from "./clock";
import { initialPlaybackState, usePlaybackStore } from "./store";
import { usePlaybackLoop } from "./usePlaybackLoop";

function fakeFrames() {
  let nextId = 1;
  let time = 0;
  const queue = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  return {
    raf: (cb: FrameRequestCallback): number => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number): void => {
      cancelled.push(id);
      queue.delete(id);
    },
    now: (): number => time,
    /** Advance the fake clock and flush the currently queued callbacks. */
    frame(ms: number): void {
      time += ms;
      const pending = [...queue.entries()];
      queue.clear();
      act(() => {
        for (const [, cb] of pending) cb(time);
      });
    },
    pending: () => queue.size,
    cancelled,
  };
}

const get = () => usePlaybackStore.getState();

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState(), durationMs: 10_000 });
});

describe("usePlaybackLoop", () => {
  it("does not schedule while paused", () => {
    const f = fakeFrames();
    renderHook(() => usePlaybackLoop({ raf: f.raf, caf: f.caf, now: f.now }));
    expect(f.pending()).toBe(0);
  });

  it("ticks every frame while playing, with the region rate", () => {
    const f = fakeFrames();
    const rateAt = rateAtFromRegions([{ startMs: 32, endMs: 10_000, rate: 2 }]);
    renderHook(() => usePlaybackLoop({ rateAt, raf: f.raf, caf: f.caf, now: f.now }));
    act(() => get().play());
    expect(f.pending()).toBe(1);
    f.frame(16);
    expect(get().currentMs).toBe(16);
    f.frame(16);
    expect(get().currentMs).toBe(32);
    f.frame(16);
    expect(get().currentMs).toBe(64);
    expect(f.pending()).toBe(1);
  });

  it("stops scheduling after pause", () => {
    const f = fakeFrames();
    renderHook(() => usePlaybackLoop({ raf: f.raf, caf: f.caf, now: f.now }));
    act(() => get().play());
    f.frame(16);
    act(() => get().pause());
    expect(f.pending()).toBe(0);
    expect(f.cancelled.length).toBe(1);
    const at = get().currentMs;
    f.frame(16);
    expect(get().currentMs).toBe(at);
  });

  it("stops scheduling when playback reaches the end", () => {
    const f = fakeFrames();
    usePlaybackStore.setState({ durationMs: 20 });
    renderHook(() => usePlaybackLoop({ raf: f.raf, caf: f.caf, now: f.now }));
    act(() => get().play());
    f.frame(50);
    expect(get().isPlaying).toBe(false);
    expect(get().currentMs).toBe(20);
    expect(f.pending()).toBe(0);
  });

  it("cancels on unmount", () => {
    const f = fakeFrames();
    const { unmount } = renderHook(() => usePlaybackLoop({ raf: f.raf, caf: f.caf, now: f.now }));
    act(() => get().play());
    expect(f.pending()).toBe(1);
    unmount();
    expect(f.pending()).toBe(0);
    expect(f.cancelled.length).toBe(1);
  });
});
