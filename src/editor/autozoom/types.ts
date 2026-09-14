/**
 * Local input/output types for the auto-zoom suggestion engine
 * (ENGINEERING_SPEC §8). All coordinates are normalized 0..1. All times are
 * milliseconds. This module is pure and deterministic: no DOM, no Electron, no
 * `Date.now()`, no randomness.
 */

export type CursorType = string;

/** A cursor sample: [timeMs, x, y, cursorType]. x,y normalized 0..1. */
export type TelemetryPoint = readonly [
  tMs: number,
  x: number,
  y: number,
  cursorType: CursorType,
];

export type MouseButton = "left" | "middle" | "right";
export type ClickPhase = "down" | "up";

/** A mouse click sample: [timeMs, x, y, button, phase]. */
export type TelemetryClick = readonly [
  tMs: number,
  x: number,
  y: number,
  button: MouseButton,
  phase: ClickPhase,
];

/** A key sample: [timeMs, keyCode, modifiers]. `modifiers` is a bitmask. */
export type TelemetryKey = readonly [tMs: number, keyCode: number, modifiers: number];

/** A scroll sample: [timeMs, dx, dy]. */
export type TelemetryScroll = readonly [tMs: number, dx: number, dy: number];

export interface Telemetry {
  readonly points: readonly TelemetryPoint[];
  readonly clicks: readonly TelemetryClick[];
  readonly keys: readonly TelemetryKey[];
  readonly scrolls: readonly TelemetryScroll[];
}

export interface ContentSize {
  readonly w: number;
  readonly h: number;
}

export interface AutoZoomOptions {
  readonly zoomOnClicks: boolean;
  readonly zoomOnTyping: boolean;
  readonly followCursor: boolean;
}

export type EaseCurve = "ease-out-cubic";

export type FocusMode = "fixed" | "follow";

export interface Focus {
  readonly mode: FocusMode;
  readonly x: number;
  readonly y: number;
}

export interface SuggestedZoom {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly level: number;
  readonly focus: Focus;
  readonly easeInMs: number;
  readonly easeOutMs: number;
  readonly curve: EaseCurve;
  readonly source: "auto";
  readonly reason: string;
}

export interface SuggestParams {
  readonly telemetry: Telemetry;
  readonly content: ContentSize;
  readonly clips: readonly ClipRange[];
  /** 0..1. Higher = more/stronger suggestions. */
  readonly sensitivity: number;
  readonly options: AutoZoomOptions;
}

/**
 * The subset of the schema `Clip` this engine needs. Kept structural so callers
 * can pass the real `Clip` (from ../model/schema) or a plain object.
 */
export interface ClipRange {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly timelineStartMs: number;
}
