import { clamp } from "../controls";
import { DEFAULT_BASE, DEFAULT_BASE_OVERRIDES, type KeystrokeBadgeAnnotation } from "./types";

/**
 * Keystroke badge detection (ENGINEERING_SPEC §9.7). Telemetry `keys` entries
 * are `[tMs, keyCode, modifiers]`; `keyCode` is a physical key code in DOM
 * `KeyboardEvent.code` form ("KeyK", "Digit1", "Enter", "MetaLeft") and
 * `modifiers` is the `MOD` bitmask.
 */

export const MOD = { ctrl: 1, alt: 2, shift: 4, meta: 8 } as const;

export type KeyTelemetryEvent = readonly [tMs: number, keyCode: string, modifiers: number];
export type KeyPlatform = "mac" | "win" | "linux";

export interface KeystrokeCandidate {
  tMs: number;
  /** Formatted label, e.g. "⌘K" or "Ctrl+Shift+P". */
  label: string;
}

export interface ShortcutSummary {
  label: string;
  count: number;
  firstMs: number;
}

/** A lone modifier press merges into a key that follows within this window. */
export const CHORD_WINDOW_MS = 80;
/** Same shortcut again within this window is key repeat, not a new press. */
export const REPEAT_WINDOW_MS = 300;
/** "Add all" badge duration. */
export const KEYSTROKE_BADGE_MS = 1200;

const MODIFIER_CODES: Readonly<Record<string, number>> = {
  ControlLeft: MOD.ctrl,
  ControlRight: MOD.ctrl,
  AltLeft: MOD.alt,
  AltRight: MOD.alt,
  ShiftLeft: MOD.shift,
  ShiftRight: MOD.shift,
  MetaLeft: MOD.meta,
  MetaRight: MOD.meta,
  OSLeft: MOD.meta,
  OSRight: MOD.meta,
};

const PUNCTUATION: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};

const MAC_KEYS: Readonly<Record<string, string>> = {
  Enter: "↩",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  Space: "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "⇞",
  PageDown: "⇟",
  Home: "↖",
  End: "↘",
};

const PC_KEYS: Readonly<Record<string, string>> = {
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Del",
  Tab: "Tab",
  Space: "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Home: "Home",
  End: "End",
};

export function isModifierCode(code: string): boolean {
  return code in MODIFIER_CODES;
}

/** Keys that produce text; Shift + these is just typing, never a badge. */
export function isTypingKey(code: string): boolean {
  return /^(Key[A-Z]|Digit\d)$/.test(code) || code in PUNCTUATION || code === "Space";
}

export function keyGlyph(code: string, platform: KeyPlatform): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit?.[1]) return digit[1];
  const punct = PUNCTUATION[code];
  if (punct) return punct;
  const named = (platform === "mac" ? MAC_KEYS : PC_KEYS)[code];
  return named ?? code;
}

/** mac: ⌃⌥⇧⌘ glyphs, no separator. win/linux: Ctrl+Alt+Shift+Win/Super. */
export function formatShortcut(modifiers: number, code: string, platform: KeyPlatform): string {
  const key = keyGlyph(code, platform);
  if (platform === "mac") {
    let s = "";
    if (modifiers & MOD.ctrl) s += "⌃";
    if (modifiers & MOD.alt) s += "⌥";
    if (modifiers & MOD.shift) s += "⇧";
    if (modifiers & MOD.meta) s += "⌘";
    return s + key;
  }
  const parts: string[] = [];
  if (modifiers & MOD.ctrl) parts.push("Ctrl");
  if (modifiers & MOD.alt) parts.push("Alt");
  if (modifiers & MOD.shift) parts.push("Shift");
  if (modifiers & MOD.meta) parts.push(platform === "win" ? "Win" : "Super");
  parts.push(key);
  return parts.join("+");
}

/**
 * Turn raw key telemetry into shortcut candidates. Only chords with at least one
 * modifier count; plain keys and Shift+typing are dropped (privacy). Held-key
 * repeats of the same shortcut collapse into one.
 */
export function detectKeystrokes(
  keys: readonly KeyTelemetryEvent[],
  platform: KeyPlatform,
): KeystrokeCandidate[] {
  const sorted = [...keys].sort((a, b) => a[0] - b[0]);
  const out: KeystrokeCandidate[] = [];
  let pending: { mask: number; tMs: number } | null = null;
  let lastLabel = "";
  let lastMs = Number.NEGATIVE_INFINITY;

  for (const [tMs, code, rawMods] of sorted) {
    const modBit = MODIFIER_CODES[code];
    if (modBit !== undefined) {
      pending = { mask: rawMods | modBit, tMs };
      continue;
    }
    const chord = pending && tMs - pending.tMs <= CHORD_WINDOW_MS ? pending.mask : 0;
    pending = null;
    const mods = rawMods | chord;
    if (mods === 0) continue;
    if (mods === MOD.shift && isTypingKey(code)) continue;

    const label = formatShortcut(mods, code, platform);
    const isRepeat = label === lastLabel && tMs - lastMs < REPEAT_WINDOW_MS;
    lastLabel = label;
    lastMs = tMs;
    if (!isRepeat) out.push({ tMs, label });
  }
  return out;
}

/** Unique shortcuts with occurrence counts, ordered by first use. */
export function summarizeShortcuts(candidates: readonly KeystrokeCandidate[]): ShortcutSummary[] {
  const byLabel = new Map<string, ShortcutSummary>();
  for (const c of candidates) {
    const s = byLabel.get(c.label);
    if (s) {
      s.count += 1;
      s.firstMs = Math.min(s.firstMs, c.tMs);
    } else {
      byLabel.set(c.label, { label: c.label, count: 1, firstMs: c.tMs });
    }
  }
  return [...byLabel.values()].sort((a, b) => a.firstMs - b.firstMs);
}

/**
 * "Add all": one 1.2s bottom-center badge per candidate. Candidates past the
 * timeline end are skipped, and so are badges that already exist (same label
 * and start), so pressing "Add all" twice is a no-op.
 */
export function keystrokeBadgesFromCandidates(
  candidates: readonly KeystrokeCandidate[],
  opts: {
    timelineDurationMs: number;
    newId: () => string;
    existing?: readonly { kind: string; label?: string | undefined; startMs: number }[] | undefined;
  },
): KeystrokeBadgeAnnotation[] {
  const seen = new Set<string>();
  for (const a of opts.existing ?? []) {
    if (a.kind === "keystrokeBadge" && a.label !== undefined)
      seen.add(`${a.label}@${Math.round(a.startMs)}`);
  }
  const base = { ...DEFAULT_BASE, ...DEFAULT_BASE_OVERRIDES.keystrokeBadge };
  const out: KeystrokeBadgeAnnotation[] = [];
  for (const c of candidates) {
    if (c.tMs < 0 || c.tMs >= opts.timelineDurationMs) continue;
    const key = `${c.label}@${Math.round(c.tMs)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...base,
      animIn: { ...base.animIn },
      animOut: { ...base.animOut },
      x: clamp(0.5 - base.w / 2, 0, 1),
      kind: "keystrokeBadge",
      label: c.label,
      id: opts.newId(),
      startMs: c.tMs,
      endMs: Math.min(opts.timelineDurationMs, c.tMs + KEYSTROKE_BADGE_MS),
    });
  }
  return out;
}
