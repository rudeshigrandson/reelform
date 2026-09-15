import type { RecordOptions } from "../../launcher/types";

/**
 * Cross-window recording bus. The launcher window hosts the capture session
 * (MediaRecorders, finalize, project creation); the HUD, countdown, region
 * overlays and webcam bubble are separate renderer processes of the same
 * origin. They coordinate over a `BroadcastChannel`, which Chromium delivers
 * between same-origin windows of one Electron session (never to the sender).
 *
 * Only UI coordination travels here — never media. Messages are validated on
 * receipt; unknown shapes are dropped.
 */

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapshotPhase =
  | "selectingRegion"
  | "starting"
  | "countdown"
  | "recording"
  | "paused"
  | "finalizing";

export interface SessionSnapshot {
  sessionId: string | null;
  phase: SnapshotPhase;
  countdownRemaining: number | null;
  countdownTotal: number | null;
  sourceLabel: string;
  displayId: string | null;
  webcamDeviceId: string | null;
  /** What was started, so the HUD can Restart with the same setup (optional). */
  setup?: RecordOptions | undefined;
}

export type RecordingBusMessage =
  /** A window just mounted and wants the current session (reply: `snapshot`). */
  | { type: "snapshotRequest" }
  /** `null` = no live session. */
  | { type: "snapshot"; snapshot: SessionSnapshot | null }
  /** Renderer mic meter (Electron backend), 0..1. */
  | { type: "micLevel"; sessionId: string; level: number }
  /** Non-fatal capture warning code (see `warningCopy`). */
  | { type: "warning"; sessionId: string; code: string }
  /** Region chosen on one display: DIP rect (display-local) + pixel rect. */
  | {
      type: "regionSelected";
      displayId: string;
      region: RegionRect;
      pixelRegion: RegionRect;
      scaleFactor: number;
    }
  | { type: "regionCancelled"; displayId: string }
  /** The pre-record HUD asks the launcher-hosted flow to start (region → selection first). */
  | { type: "startRequest"; setup: RecordOptions }
  /** The recording pill's Mute mic toggle (guide S10); the flow mutes the mic track. */
  | { type: "hud:setMicMuted"; muted: boolean }
  /**
   * The recording pill's Restart: the flow discards the live session and starts
   * again with the same setup, keeping the HUD window open.
   */
  | { type: "hud:restart" }
  /**
   * Outline of the selected window source for the source-outline overlay of
   * `displayId` (SPEC §5.7). `bounds` is display-local DIP; null hides it.
   */
  | {
      type: "hud:sourceOutline";
      displayId: string;
      bounds: RegionRect | null;
      label?: string | undefined;
    };

export interface RecordingBus {
  post(message: RecordingBusMessage): void;
  subscribe(listener: (message: RecordingBusMessage) => void): () => void;
  close(): void;
}

export const RECORDING_BUS_CHANNEL = "reelform:recording";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);
const isRect = (v: unknown): v is RegionRect =>
  isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height);

const SNAPSHOT_PHASES: readonly string[] = [
  "selectingRegion",
  "starting",
  "countdown",
  "recording",
  "paused",
  "finalizing",
];

const MODES: readonly string[] = ["screen", "window", "region"];
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isOptStr = (v: unknown): boolean => v === undefined || isStr(v);

function isRecordOptions(v: unknown): v is RecordOptions {
  return (
    isObj(v) &&
    isStr(v.sourceId) &&
    isStr(v.mode) &&
    MODES.includes(v.mode) &&
    isBool(v.mic) &&
    isOptStr(v.micDeviceId) &&
    isBool(v.systemAudio) &&
    isBool(v.webcam) &&
    isOptStr(v.webcamDeviceId) &&
    (v.fps === 30 || v.fps === 60) &&
    (v.countdown === 0 || v.countdown === 3 || v.countdown === 5 || v.countdown === 10) &&
    isBool(v.hideCursor)
  );
}

function isSnapshot(v: unknown): v is SessionSnapshot {
  return (
    isObj(v) &&
    isStrOrNull(v.sessionId) &&
    isStr(v.phase) &&
    SNAPSHOT_PHASES.includes(v.phase) &&
    isNumOrNull(v.countdownRemaining) &&
    isNumOrNull(v.countdownTotal) &&
    isStr(v.sourceLabel) &&
    isStrOrNull(v.displayId) &&
    isStrOrNull(v.webcamDeviceId) &&
    (v.setup === undefined || isRecordOptions(v.setup))
  );
}

export function isRecordingBusMessage(v: unknown): v is RecordingBusMessage {
  if (!isObj(v) || !isStr(v.type)) return false;
  switch (v.type) {
    case "snapshotRequest":
    case "hud:restart":
      return true;
    case "snapshot":
      return v.snapshot === null || isSnapshot(v.snapshot);
    case "micLevel":
      return isStr(v.sessionId) && isNum(v.level);
    case "warning":
      return isStr(v.sessionId) && isStr(v.code);
    case "regionSelected":
      return (
        isStr(v.displayId) &&
        isRect(v.region) &&
        isRect(v.pixelRegion) &&
        isNum(v.scaleFactor) &&
        v.scaleFactor > 0
      );
    case "regionCancelled":
      return isStr(v.displayId);
    case "startRequest":
      return isRecordOptions(v.setup);
    case "hud:setMicMuted":
      return isBool(v.muted);
    case "hud:sourceOutline":
      return (
        isStr(v.displayId) &&
        (v.bounds === null || (isRect(v.bounds) && v.bounds.width >= 0 && v.bounds.height >= 0)) &&
        isOptStr(v.label)
      );
    default:
      return false;
  }
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export function createBroadcastRecordingBus(
  factory: (name: string) => BroadcastChannelLike = (name) => new BroadcastChannel(name),
): RecordingBus {
  const channel = factory(RECORDING_BUS_CHANNEL);
  const listeners = new Set<(event: { data: unknown }) => void>();
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (listener) => {
      const wrapped = (event: { data: unknown }): void => {
        if (isRecordingBusMessage(event.data)) listener(event.data);
      };
      listeners.add(wrapped);
      channel.addEventListener("message", wrapped);
      return () => {
        listeners.delete(wrapped);
        channel.removeEventListener("message", wrapped);
      };
    },
    close: () => {
      for (const l of listeners) channel.removeEventListener("message", l);
      listeners.clear();
      channel.close();
    },
  };
}

/**
 * In-memory hub with BroadcastChannel semantics (async delivery, never to the
 * posting endpoint, structured-clone copies). For tests and single-window dev.
 */
export function createMemoryBusHub() {
  const endpoints = new Set<{ deliver(m: RecordingBusMessage): void }>();
  return {
    endpoint(): RecordingBus {
      const listeners = new Set<(m: RecordingBusMessage) => void>();
      let closed = false;
      const self = {
        deliver: (m: RecordingBusMessage) => {
          if (closed) return;
          for (const l of [...listeners]) l(structuredClone(m));
        },
      };
      endpoints.add(self);
      return {
        post: (message) => {
          if (closed) return;
          for (const ep of endpoints) {
            if (ep !== self) queueMicrotask(() => ep.deliver(message));
          }
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close: () => {
          closed = true;
          listeners.clear();
          endpoints.delete(self);
        },
      };
    },
  };
}
