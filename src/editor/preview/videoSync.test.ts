import { describe, expect, it, vi } from "vitest";
import type { Clip } from "../model/schema";
import {
  FRAME_S,
  SCRUB_WINDOW_MS,
  type VideoElementLike,
  applyVideoSync,
  decideVideoSync,
  isScrubbing,
  watchVideoFrames,
} from "./videoSync";

class FakeVideo implements VideoElementLike {
  currentTime = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  preservesPitch: boolean | undefined = true;
  fastSeek: ((t: number) => void) | undefined = vi.fn((t: number) => {
    this.currentTime = t;
  });
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  listeners = new Map<string, Set<() => void>>();
  requestVideoFrameCallback: ((cb: () => void) => number) | undefined;
  cancelVideoFrameCallback: ((h: number) => void) | undefined;
  addEventListener(type: string, l: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(l);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, l: () => void): void {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l();
  }
}

const clips: Clip[] = [
  { id: "a", sourceStartMs: 1000, sourceEndMs: 3000, timelineStartMs: 0 },
  { id: "b", sourceStartMs: 6000, sourceEndMs: 9000, timelineStartMs: 2000 },
];

const base = { isPlaying: false, scrubbing: false, video: { currentTime: 0, paused: true } };

describe("decideVideoSync", () => {
  it("paused: precise seek beyond one frame, none within", () => {
    const d = decideVideoSync({ ...base, timelineMs: 2500 });
    expect(d.seek).toEqual({ toS: 2.5, mode: "precise" });
    expect(d.transport).toBeNull();
    const near = decideVideoSync({
      ...base,
      timelineMs: 2505,
      video: { currentTime: 2.5, paused: true },
    });
    expect(near.seek).toBeNull();
  });

  it("scrubbing uses fastSeek mode", () => {
    expect(decideVideoSync({ ...base, scrubbing: true, timelineMs: 4000 }).seek?.mode).toBe("fast");
  });

  it("maps through clips and seeks at a clip boundary while playing", () => {
    const d = decideVideoSync({
      ...base,
      clips,
      isPlaying: true,
      timelineMs: 2000,
      prevClipId: "a",
      video: { currentTime: 3.0, paused: false },
    });
    expect(d.clipId).toBe("b");
    expect(d.seek).toEqual({ toS: 6, mode: "precise" });
    expect(d.transport).toBeNull();
  });

  it("playing: tolerates small drift, resyncs on gross drift, starts a paused element", () => {
    const small = decideVideoSync({
      ...base,
      isPlaying: true,
      timelineMs: 1000,
      prevClipId: null,
      video: { currentTime: 1.1, paused: true },
    });
    expect(small.seek).toBeNull();
    expect(small.transport).toBe("play");
    const gross = decideVideoSync({
      ...base,
      isPlaying: true,
      timelineMs: 1000,
      prevClipId: null,
      video: { currentTime: 2, paused: false },
    });
    expect(gross.seek?.mode).toBe("precise");
  });

  it("drift tolerance scales with playback rate", () => {
    const speeds = [{ startMs: 0, endMs: 10_000, rate: 4 }];
    const d = decideVideoSync({
      ...base,
      speeds,
      isPlaying: true,
      timelineMs: 1000,
      prevClipId: null,
      video: { currentTime: 1.6, paused: false },
    });
    expect(d.playbackRate).toBe(4);
    expect(d.seek).toBeNull();
  });

  it("a gap between clips hides the video and pauses", () => {
    const d = decideVideoSync({
      ...base,
      clips,
      timelineMs: 9000,
      video: { currentTime: 3, paused: false },
    });
    expect(d.visible).toBe(false);
    expect(d.targetS).toBeNull();
    expect(d.transport).toBe("pause");
  });

  it("applies a sync offset and never seeks negative", () => {
    expect(decideVideoSync({ ...base, timelineMs: 1000, offsetMs: 250 }).targetS).toBeCloseTo(1.25);
    expect(decideVideoSync({ ...base, timelineMs: 100, offsetMs: -500 }).targetS).toBe(0);
  });

  it("non-finite element time is treated as 0", () => {
    const d = decideVideoSync({
      ...base,
      timelineMs: 0,
      video: { currentTime: Number.NaN, paused: true },
    });
    expect(d.seek).toBeNull();
    expect(FRAME_S).toBeGreaterThan(0);
  });
});

describe("applyVideoSync", () => {
  it("fast seeks via fastSeek, precise via currentTime, and sets rate / pitch", () => {
    const v = new FakeVideo();
    applyVideoSync(v, {
      targetS: 2,
      clipId: null,
      seek: { toS: 2, mode: "fast" },
      transport: null,
      playbackRate: 2,
      preservesPitch: false,
      visible: true,
    });
    expect(v.fastSeek).toHaveBeenCalledWith(2);
    expect(v.playbackRate).toBe(2);
    expect(v.preservesPitch).toBe(false);
    applyVideoSync(v, {
      targetS: 3,
      clipId: null,
      seek: { toS: 3, mode: "precise" },
      transport: "play",
      playbackRate: 2,
      preservesPitch: false,
      visible: true,
    });
    expect(v.currentTime).toBe(3);
    expect(v.play).toHaveBeenCalledTimes(1);
  });

  it("falls back to currentTime when fastSeek is missing and swallows play rejections", async () => {
    const v = new FakeVideo();
    v.fastSeek = undefined;
    v.play = vi.fn(() => Promise.reject(new Error("autoplay")));
    applyVideoSync(v, {
      targetS: 5,
      clipId: null,
      seek: { toS: 5, mode: "fast" },
      transport: "play",
      playbackRate: 1,
      preservesPitch: true,
      visible: true,
    });
    expect(v.currentTime).toBe(5);
    await Promise.resolve();
  });

  it("pauses", () => {
    const v = new FakeVideo();
    v.paused = false;
    applyVideoSync(v, {
      targetS: 0,
      clipId: null,
      seek: null,
      transport: "pause",
      playbackRate: 1,
      preservesPitch: true,
      visible: true,
    });
    expect(v.pause).toHaveBeenCalled();
  });
});

describe("isScrubbing", () => {
  it("is true only for seeks within the window", () => {
    expect(isScrubbing(null, 100)).toBe(false);
    expect(isScrubbing(100, 100 + SCRUB_WINDOW_MS - 1)).toBe(true);
    expect(isScrubbing(100, 100 + SCRUB_WINDOW_MS)).toBe(false);
    expect(isScrubbing(200, 100)).toBe(false);
  });
});

describe("watchVideoFrames", () => {
  it("uses requestVideoFrameCallback and re-registers each frame", () => {
    const v = new FakeVideo();
    const cbs: Array<() => void> = [];
    v.requestVideoFrameCallback = vi.fn((cb: () => void) => cbs.push(cb));
    v.cancelVideoFrameCallback = vi.fn();
    const onFrame = vi.fn();
    const stop = watchVideoFrames(v, onFrame);
    cbs[0]?.();
    cbs[1]?.();
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(v.requestVideoFrameCallback).toHaveBeenCalledTimes(3);
    stop();
    expect(v.cancelVideoFrameCallback).toHaveBeenCalled();
    cbs[2]?.();
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it("falls back to seeked/timeupdate events", () => {
    const v = new FakeVideo();
    const onFrame = vi.fn();
    const stop = watchVideoFrames(v, onFrame);
    v.emit("seeked");
    v.emit("timeupdate");
    expect(onFrame).toHaveBeenCalledTimes(2);
    stop();
    v.emit("seeked");
    expect(onFrame).toHaveBeenCalledTimes(2);
  });
});
