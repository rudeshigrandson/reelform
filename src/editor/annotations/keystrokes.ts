import {
  type KeyPlatform,
  type KeyTelemetryEvent,
  detectKeystrokes,
  keystrokeBadgesFromCandidates,
} from "../inspector/annotations/keystrokes";
import type { KeystrokeBadgeAnnotation } from "../inspector/annotations/types";

/**
 * Keystroke badges (ENGINEERING_SPEC §9.7: `annotations/keystrokes.ts`).
 *
 * The grouping engine already ships with the Annotate inspector
 * (`inspector/annotations/keystrokes.ts`): chords = a modifier press merged
 * into a key within 80ms, shortcuts = ≥ 1 modifier, platform glyphs
 * (⌃⌥⇧⌘ on mac, Ctrl/Alt/Shift/Win|Super elsewhere), a key-code → label table,
 * and the privacy rule (plain keys and Shift+typing never produce badges).
 * This module is the spec's canonical path for it, re-exporting that single
 * implementation plus the telemetry → "Add all" pipeline.
 */

export {
  CHORD_WINDOW_MS,
  KEYSTROKE_BADGE_MS,
  MOD,
  REPEAT_WINDOW_MS,
  detectKeystrokes,
  formatShortcut,
  isModifierCode,
  isTypingKey,
  keyGlyph,
  keystrokeBadgesFromCandidates,
  summarizeShortcuts,
} from "../inspector/annotations/keystrokes";
export type {
  KeyPlatform,
  KeyTelemetryEvent,
  KeystrokeCandidate,
  ShortcutSummary,
} from "../inspector/annotations/keystrokes";

export interface AddAllOptions {
  timelineDurationMs: number;
  newId: () => string;
  existing?: readonly { kind: string; label?: string | undefined; startMs: number }[] | undefined;
}

/**
 * "Add all": telemetry `keys[]` → 1.2s bottom-center keystroke badges, one per
 * detected shortcut, skipping badges that already exist.
 */
export function addAllKeystrokeBadges(
  keys: readonly KeyTelemetryEvent[],
  platform: KeyPlatform,
  opts: AddAllOptions,
): KeystrokeBadgeAnnotation[] {
  return keystrokeBadgesFromCandidates(detectKeystrokes(keys, platform), opts);
}
