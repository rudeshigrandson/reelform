import type { Clip } from "../model/schema";
import {
  type SpeedLike,
  mapTimelineToSource,
  playbackRateAt,
  preservesPitchAt,
} from "./timeMapping";

/**
 * Hidden <video> synchronisation (ENGINEERING_SPEC §6.3). `decideVideoSync`
 * is pure — given the transport and the element's reported state it says
 * what to do; `applyVideoSync` performs it on an element. Tests drive both
 * with a fake element.
 */

/** One frame at 60fps, in seconds: paused drift beyond this re-seeks. */
export const FRAME_S = 1 / 60;
/** While playing the element leads; resync only on gross drift (scaled by rate). */
export const PLAYING_RESYNC_S = 0.25;
/** Paused seeks closer together than this are treated as a scrub. */
export const SCRUB_WINDOW_MS = 120;
/** After the last scrub seek, a precise seek settles the exact frame. */
export const SCRUB_SETTLE_MS = 160;

/** The subset of HTMLVideoElement the preview uses. */
export interface VideoElementLike {
  currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  playbackRate: number;
  preservesPitch?: boolean | undefined;
  play(): Promise<void> | undefined | void;
  pause(): void;
  fastSeek?: ((time: number) => void) | undefined;
  requestVideoFrameCallback?: ((cb: () => void) => number) | undefined;
  cancelVideoFrameCallback?: ((handle: number) => void) | undefined;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface VideoSyncInput {
  timelineMs: number;
  isPlaying: boolean;
  /** Dragging the playhead: seek with `fastSeek`. */
  scrubbing: boolean;
  clips?: readonly Clip[] | null | undefined;
  speeds?: readonly SpeedLike[] | undefined;
  /** J/K/L shuttle multiplier while playing. */
  shuttleRate?: number | undefined;
  /** Added to the source time (webcam `syncOffsetMs`). */
  offsetMs?: number | undefined;
  /** Clip id of the previous decision; undefined on the first one. */
  prevClipId?: string | null | undefined;
  video: { currentTime: number; paused: boolean };
}

export interface VideoSyncDecision {
  /** Target media time (s), or null when the timeline time maps to no clip. */
  targetS: number | null;
  clipId: string | null;
  seek: { toS: number; mode: "fast" | "precise" } | null;
  transport: "play" | "pause" | null;
  playbackRate: number;
  preservesPitch: boolean;
  /** False in a gap (no clip): the stage shows the placeholder. */
  visible: boolean;
}

export function decideVideoSync(input: VideoSyncInput): VideoSyncDecision {
  const t = input.timelineMs;
  const speeds = input.speeds ?? [];
  const src = mapTimelineToSource(input.clips, t);
  const { video } = input;
  if (!src) {
    return {
      targetS: null,
      clipId: null,
      seek: null,
      transport: video.paused ? null : "pause",
      playbackRate: 1,
      preservesPitch: true,
      visible: false,
    };
  }
  const offset = Number.isFinite(input.offsetMs) ? (input.offsetMs as number) : 0;
  const targetS = Math.max(0, (src.sourceMs + offset) / 1000);
  const playbackRate = playbackRateAt(speeds, t, input.isPlaying ? (input.shuttleRate ?? 1) : 1);
  const preservesPitch = preservesPitchAt(speeds, t);
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const drift = Math.abs(current - targetS);
  const clipChanged = input.prevClipId !== undefined && input.prevClipId !== src.clipId;

  let seek: VideoSyncDecision["seek"] = null;
  let transport: VideoSyncDecision["transport"] = null;
  if (input.isPlaying) {
    // A trim boundary is a discontinuity in source time: seek right away.
    if ((clipChanged && drift > FRAME_S) || drift > PLAYING_RESYNC_S * Math.max(1, playbackRate)) {
      seek = { toS: targetS, mode: "precise" };
    }
    if (video.paused) transport = "play";
  } else {
    if (!video.paused) transport = "pause";
    if (drift > FRAME_S) seek = { toS: targetS, mode: input.scrubbing ? "fast" : "precise" };
  }
  return {
    targetS,
    clipId: src.clipId,
    seek,
    transport,
    playbackRate,
    preservesPitch,
    visible: true,
  };
}

/** Apply a decision to an element. `fastSeek` falls back to `currentTime`. */
export function applyVideoSync(el: VideoElementLike, d: VideoSyncDecision): void {
  if (Math.abs(el.playbackRate - d.playbackRate) > 1e-6) el.playbackRate = d.playbackRate;
  if (el.preservesPitch !== undefined && el.preservesPitch !== d.preservesPitch) {
    el.preservesPitch = d.preservesPitch;
  }
  if (d.seek) {
    if (d.seek.mode === "fast" && typeof el.fastSeek === "function") el.fastSeek(d.seek.toS);
    else el.currentTime = d.seek.toS;
  }
  if (d.transport === "play") {
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } else if (d.transport === "pause") {
    el.pause();
  }
}

/** Whether a paused seek at `nowMs` continues a scrub started by one at `lastSeekMs`. */
export function isScrubbing(lastSeekMs: number | null, nowMs: number): boolean {
  return lastSeekMs !== null && nowMs - lastSeekMs >= 0 && nowMs - lastSeekMs < SCRUB_WINDOW_MS;
}

/**
 * Call `onFrame` whenever the element presents a new frame: via
 * `requestVideoFrameCallback` when available (accurate, fires after seeks
 * too), else on `seeked` / `loadeddata` / `timeupdate`. Returns an unsubscribe.
 */
export function watchVideoFrames(el: VideoElementLike, onFrame: () => void): () => void {
  if (typeof el.requestVideoFrameCallback === "function") {
    let handle = 0;
    let active = true;
    const tick = (): void => {
      if (!active) return;
      onFrame();
      handle = el.requestVideoFrameCallback?.(tick) ?? 0;
    };
    handle = el.requestVideoFrameCallback(tick);
    // A seek on a paused element before the first frame: also catch loadeddata.
    el.addEventListener("loadeddata", onFrame);
    return () => {
      active = false;
      el.cancelVideoFrameCallback?.(handle);
      el.removeEventListener("loadeddata", onFrame);
    };
  }
  const events = ["seeked", "loadeddata", "timeupdate"] as const;
  for (const e of events) el.addEventListener(e, onFrame);
  return () => {
    for (const e of events) el.removeEventListener(e, onFrame);
  };
}
