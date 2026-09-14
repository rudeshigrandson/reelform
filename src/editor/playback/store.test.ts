import { beforeEach, describe, expect, it } from "vitest";
import { rateAtFromRegions } from "./clock";
import { initialPlaybackState, usePlaybackStore } from "./store";

const get = () => usePlaybackStore.getState();

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState(), durationMs: 10_000, fps: 30 });
});

describe("playback store", () => {
  it("seek clamps", () => {
    get().seek(-5);
    expect(get().currentMs).toBe(0);
    get().seek(50_000);
    expect(get().currentMs).toBe(10_000);
    get().seek(1234);
    expect(get().currentMs).toBe(1234);
  });

  it("play at end restarts from 0", () => {
    get().seek(10_000);
    get().play();
    expect(get().isPlaying).toBe(true);
    expect(get().currentMs).toBe(0);
  });

  it("does not play with zero duration", () => {
    get().setDuration(0);
    get().play();
    expect(get().isPlaying).toBe(false);
  });

  it("toggle flips play state", () => {
    get().toggle();
    expect(get().isPlaying).toBe(true);
    expect(get().shuttleRate).toBe(1);
    get().toggle();
    expect(get().isPlaying).toBe(false);
    expect(get().shuttleRate).toBe(0);
  });

  it("skips to start and end", () => {
    get().seek(4000);
    get().skipToEnd();
    expect(get().currentMs).toBe(10_000);
    get().skipToStart();
    expect(get().currentMs).toBe(0);
  });

  it("setDuration clamps currentMs", () => {
    get().seek(8000);
    get().setDuration(5000);
    expect(get().durationMs).toBe(5000);
    expect(get().currentMs).toBe(5000);
    get().setDuration(-1);
    expect(get().durationMs).toBe(0);
    expect(get().currentMs).toBe(0);
  });

  it("stepSecond and stepFrame move and clamp", () => {
    get().seek(2000);
    get().stepSecond(1);
    expect(get().currentMs).toBe(3000);
    get().stepSecond(-10);
    expect(get().currentMs).toBe(0);
    get().stepFrame(3);
    expect(get().currentMs).toBeCloseTo(100, 9);
  });

  it("setFps ignores invalid values", () => {
    get().setFps(0);
    expect(get().fps).toBe(30);
    get().setFps(60);
    expect(get().fps).toBe(60);
  });

  it("tick advances with regions and stops at end", () => {
    get().play();
    get().tick(100, rateAtFromRegions([{ startMs: 0, endMs: 10_000, rate: 2 }]));
    expect(get().currentMs).toBe(200);
    get().tick(20_000);
    expect(get().currentMs).toBe(10_000);
    expect(get().isPlaying).toBe(false);
  });

  it("tick is a no-op while paused", () => {
    get().tick(100);
    expect(get().currentMs).toBe(0);
  });

  it("J/K/L shuttle", () => {
    get().seek(5000);
    get().shuttleForward();
    expect(get().isPlaying).toBe(true);
    expect(get().shuttleRate).toBe(1);
    get().shuttleForward();
    expect(get().shuttleRate).toBe(2);
    get().tick(100);
    expect(get().currentMs).toBe(5200);
    get().shuttleForward();
    get().shuttleForward();
    expect(get().shuttleRate).toBe(4);
    get().shuttleStop();
    expect(get().isPlaying).toBe(false);
    get().shuttleBack();
    expect(get().currentMs).toBe(4200);
    expect(get().isPlaying).toBe(false);
  });
});
