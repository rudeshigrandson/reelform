import {
  type Accelerator,
  type KeyEventLike,
  type ShortcutPlatform,
  acceleratorFromEvent,
  acceleratorsEqual,
  formatAccelerator,
} from "./accelerator";
import { type ShortcutConflict, conflictsFor, hasBlockingConflict } from "./conflicts";
import { type ShortcutsTranslate, shortcutGroupLabel, shortcutLabel, st } from "./i18n";
import type { ResolvedShortcut, ShortcutGroup } from "./registry";

/**
 * Inline key recording for the Settings › Shortcuts table (S24) and grouping /
 * search helpers shared with the "?" overlay (S25). Pure.
 */

export type RecordOutcome =
  /** Plain Escape: stop recording, keep the current binding. */
  | { kind: "cancel" }
  /** Modifier-only press, plain Tab, or an unknown key: keep listening. */
  | { kind: "ignore" }
  /** Keys that can't be used for this shortcut (keep listening, explain why). */
  | { kind: "invalid"; display: string; message: string }
  | {
      kind: "candidate";
      accelerator: Accelerator;
      display: string;
      conflicts: ShortcutConflict[];
      /** A `duplicate` conflict: main would reject it with SHORTCUT_CONFLICT. */
      blocking: boolean;
      /** Same keys as the current binding (nothing to save). */
      unchanged: boolean;
    };

const plain = (e: KeyEventLike) => !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;

export function evaluateRecordedKey(
  id: string,
  e: KeyEventLike,
  resolved: readonly ResolvedShortcut[],
  platform: ShortcutPlatform,
  translate: ShortcutsTranslate = st,
): RecordOutcome {
  if (e.key === "Escape" && plain(e)) return { kind: "cancel" };
  if (e.key === "Tab" && plain(e)) return { kind: "ignore" };
  const accelerator = acceleratorFromEvent(e);
  if (!accelerator) return { kind: "ignore" };
  const self = resolved.find((r) => r.id === id);
  // A global shortcut is registered with the OS and steals the key in every
  // app, so it needs Ctrl/Alt/Cmd (Shift alone still types) unless it's a
  // function key. Countdown-only globals (Esc) are exempt: live for 3s only.
  if (
    self?.scope === "global" &&
    !self.def.countdownOnly &&
    !accelerator.ctrl &&
    !accelerator.alt &&
    !accelerator.meta &&
    !/^F([1-9]|1[0-9]|2[0-4])$/.test(accelerator.key)
  ) {
    return {
      kind: "invalid",
      display: formatAccelerator(accelerator, platform),
      message: translate(
        platform === "mac"
          ? "shortcuts.invalid.globalModifiers.mac"
          : "shortcuts.invalid.globalModifiers.win",
      ),
    };
  }
  const conflicts = conflictsFor(id, accelerator, resolved);
  const current = self?.accelerator ?? null;
  return {
    kind: "candidate",
    accelerator,
    display: formatAccelerator(accelerator, platform),
    conflicts,
    blocking: hasBlockingConflict(conflicts),
    unchanged: current !== null && acceleratorsEqual(current, accelerator),
  };
}

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ["Global", "Editor", "Timeline"];

export interface ShortcutGroupRows {
  group: ShortcutGroup;
  rows: ResolvedShortcut[];
}

/** Group resolved shortcuts in S24 order, keeping registry order inside a group. */
export function groupShortcuts(resolved: readonly ResolvedShortcut[]): ShortcutGroupRows[] {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    rows: resolved.filter((r) => r.def.group === group),
  })).filter((g) => g.rows.length > 0);
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD");

/** Case-insensitive search over the localized label and group, display string and id. */
export function filterShortcuts(
  resolved: readonly ResolvedShortcut[],
  query: string,
  translate: ShortcutsTranslate = st,
): ResolvedShortcut[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...resolved];
  return resolved.filter((r) => {
    const label = shortcutLabel(r.def, translate);
    const group = shortcutGroupLabel(r.def.group, translate);
    const hay = fold(`${label} ${group} ${r.display} ${r.id}`);
    return terms.every((t) => hay.includes(t));
  });
}

/** Localized label of a shortcut id for conflict messages. */
export function shortcutLabelFor(
  id: string,
  resolved: readonly ResolvedShortcut[],
  translate: ShortcutsTranslate = st,
): string {
  const def = resolved.find((r) => r.id === id)?.def;
  return def ? shortcutLabel(def, translate) : id;
}
