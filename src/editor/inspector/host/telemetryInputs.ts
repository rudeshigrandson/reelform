import type { Telemetry } from "../../autozoom";
import type { Clip } from "../../model/schema";
import {
  type KeyPlatform,
  type KeyTelemetryEvent,
  type KeystrokeCandidate,
  MOD,
  detectKeystrokes,
} from "../annotations/keystrokes";
import type { CursorSample } from "../effects/types";
import { sourceToTimelineMs } from "./timeMap";

/**
 * Telemetry → inspector inputs. `telemetry.json` keys are uiohook key codes
 * (PC set-1 scan codes, 0x0Exx / 0xE0xx for extended keys) with the recorder's
 * modifier mask (shift 1, ctrl 2, alt 4, meta 8 — electron/recording/telemetry.ts);
 * the keystroke detector wants DOM `KeyboardEvent.code` + its own `MOD` mask.
 */

export const REC_MOD = { shift: 1, ctrl: 2, alt: 4, meta: 8 } as const;

const LETTER_ROWS: ReadonlyArray<[number, string]> = [
  [0x10, "QWERTYUIOP"],
  [0x1e, "ASDFGHJKL"],
  [0x2c, "ZXCVBNM"],
];

const UIOHOOK_CODES: ReadonlyMap<number, string> = (() => {
  const m = new Map<number, string>();
  for (const [start, letters] of LETTER_ROWS) {
    [...letters].forEach((l, i) => m.set(start + i, `Key${l}`));
  }
  for (let d = 1; d <= 9; d++) m.set(0x01 + d, `Digit${d}`);
  m.set(0x0b, "Digit0");
  const fixed: Array<[number, string]> = [
    [0x01, "Escape"],
    [0x0c, "Minus"],
    [0x0d, "Equal"],
    [0x0e, "Backspace"],
    [0x0f, "Tab"],
    [0x1a, "BracketLeft"],
    [0x1b, "BracketRight"],
    [0x1c, "Enter"],
    [0x1d, "ControlLeft"],
    [0x27, "Semicolon"],
    [0x28, "Quote"],
    [0x29, "Backquote"],
    [0x2a, "ShiftLeft"],
    [0x2b, "Backslash"],
    [0x33, "Comma"],
    [0x34, "Period"],
    [0x35, "Slash"],
    [0x36, "ShiftRight"],
    [0x38, "AltLeft"],
    [0x39, "Space"],
    [0x57, "F11"],
    [0x58, "F12"],
    [0x0e1c, "Enter"],
    [0x0e1d, "ControlRight"],
    [0x0e38, "AltRight"],
    [0x0e47, "Home"],
    [0x0e49, "PageUp"],
    [0x0e4f, "End"],
    [0x0e51, "PageDown"],
    [0x0e52, "Insert"],
    [0x0e53, "Delete"],
    [0x0e5b, "MetaLeft"],
    [0x0e5c, "MetaRight"],
    [0x0e48, "ArrowUp"],
    [0x0e4b, "ArrowLeft"],
    [0x0e4d, "ArrowRight"],
    [0x0e50, "ArrowDown"],
    [0xe048, "ArrowUp"],
    [0xe04b, "ArrowLeft"],
    [0xe04d, "ArrowRight"],
    [0xe050, "ArrowDown"],
  ];
  for (const [k, v] of fixed) m.set(k, v);
  for (let f = 1; f <= 10; f++) m.set(0x3a + f, `F${f}`);
  return m;
})();

/** DOM code for a uiohook key code, or null when unknown. */
export function uiohookToDomCode(keycode: number): string | null {
  return UIOHOOK_CODES.get(keycode) ?? null;
}

export function recorderModsToMod(mods: number): number {
  return (
    (mods & REC_MOD.ctrl ? MOD.ctrl : 0) |
    (mods & REC_MOD.alt ? MOD.alt : 0) |
    (mods & REC_MOD.shift ? MOD.shift : 0) |
    (mods & REC_MOD.meta ? MOD.meta : 0)
  );
}

export function telemetryKeysToEvents(keys: Telemetry["keys"]): KeyTelemetryEvent[] {
  const out: KeyTelemetryEvent[] = [];
  for (const [t, code, mods] of keys) {
    const dom = uiohookToDomCode(code);
    if (dom !== null) out.push([t, dom, recorderModsToMod(mods)]);
  }
  return out;
}

/** Shortcut candidates on timeline ms; presses inside trimmed ranges are dropped. */
export function detectTelemetryShortcuts(
  telemetry: Pick<Telemetry, "keys"> | null,
  clips: readonly Clip[],
  platform: KeyPlatform,
): KeystrokeCandidate[] {
  if (!telemetry) return [];
  const out: KeystrokeCandidate[] = [];
  for (const c of detectKeystrokes(telemetryKeysToEvents(telemetry.keys), platform)) {
    const t = clips.length > 0 ? sourceToTimelineMs(clips, c.tMs) : c.tMs;
    if (t !== null) out.push({ tMs: t, label: c.label });
  }
  return out;
}

/**
 * Cursor samples for idle detection, on timeline ms. Clicks and key presses are
 * inserted as `click: true` samples at the last known position so they break
 * idleness (§9.8: "no keys/clicks").
 */
export function cursorSamplesFromTelemetry(
  telemetry: Telemetry | null,
  clips: readonly Clip[],
): CursorSample[] | null {
  if (!telemetry || telemetry.points.length === 0) return null;
  const events: CursorSample[] = telemetry.points.map(([tMs, x, y]) => ({ tMs, x, y }));
  const breaks = [
    ...telemetry.clicks.filter((c) => c[4] === "down").map((c) => c[0]),
    ...telemetry.keys.map((k) => k[0]),
  ].sort((a, b) => a - b);
  const sorted = [...events].sort((a, b) => a.tMs - b.tMs);
  let pi = 0;
  const withBreaks: CursorSample[] = [];
  for (const t of breaks) {
    while (pi < sorted.length && (sorted[pi] as CursorSample).tMs <= t) {
      withBreaks.push(sorted[pi] as CursorSample);
      pi++;
    }
    const last = withBreaks.at(-1) ?? sorted[0];
    if (last) withBreaks.push({ tMs: t, x: last.x, y: last.y, click: true });
  }
  while (pi < sorted.length) withBreaks.push(sorted[pi++] as CursorSample);
  if (clips.length === 0) return withBreaks;
  const mapped: CursorSample[] = [];
  let prevTimeline: number | null = null;
  for (const s of withBreaks) {
    const t = sourceToTimelineMs(clips, s.tMs);
    if (t === null) {
      prevTimeline = null;
      continue;
    }
    // A jump across a cut is not stillness: mark it as a break.
    const jumped = prevTimeline !== null && t < prevTimeline;
    mapped.push(jumped ? { ...s, tMs: t, click: true } : { ...s, tMs: t });
    prevTimeline = t;
  }
  return mapped.sort((a, b) => a.tMs - b.tMs);
}
