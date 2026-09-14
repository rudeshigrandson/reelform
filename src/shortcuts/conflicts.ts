import { type Accelerator, acceleratorsEqual, serializeAccelerator } from "./accelerator";
import type { ResolvedShortcut, ShortcutScope } from "./registry";

/**
 * Conflict detection at edit time (ENGINEERING_SPEC §6.9).
 *
 * - `duplicate`: same accelerator in the same scope, or either side is
 *   `global` (the OS registration steals the key everywhere). Must be fixed.
 * - `shadow`: same accelerator in `editor` and a nested focus scope
 *   (`timeline` / `canvas`). Intentional for defaults (← steps frames in the
 *   editor but nudges the selection in the timeline) — shown as a hint only.
 * - `timeline` and `canvas` never overlap (focus is in one or the other).
 */
export type ConflictKind = "duplicate" | "shadow";

export interface ShortcutConflict {
  /** The two shortcut ids, in registry order. */
  ids: readonly [string, string];
  /** Canonical accelerator both are bound to. */
  accelerator: string;
  kind: ConflictKind;
}

export function scopeRelation(a: ShortcutScope, b: ShortcutScope): ConflictKind | null {
  if (a === b || a === "global" || b === "global") return "duplicate";
  if (a === "editor" || b === "editor") return "shadow";
  return null;
}

/**
 * Relation between two shortcuts. A countdown-only global (Esc) is live only
 * while the countdown overlay is up, so it never collides with window scopes.
 */
export function shortcutRelation(a: ResolvedShortcut, b: ResolvedShortcut): ConflictKind | null {
  const aCountdown = a.def.countdownOnly === true;
  const bCountdown = b.def.countdownOnly === true;
  if (aCountdown !== bCountdown && (aCountdown ? b.scope : a.scope) !== "global") return null;
  return scopeRelation(a.scope, b.scope);
}

/** All pairwise conflicts among bound shortcuts. */
export function detectConflicts(resolved: readonly ResolvedShortcut[]): ShortcutConflict[] {
  const out: ShortcutConflict[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const a = resolved[i];
    if (!a?.accelerator) continue;
    for (let j = i + 1; j < resolved.length; j++) {
      const b = resolved[j];
      if (!b?.accelerator || !acceleratorsEqual(a.accelerator, b.accelerator)) continue;
      const kind = shortcutRelation(a, b);
      if (kind)
        out.push({ ids: [a.id, b.id], accelerator: serializeAccelerator(a.accelerator), kind });
    }
  }
  return out;
}

/**
 * Conflicts the candidate binding for `id` would create — used while the user
 * records new keys in Settings (inline warning). The shortcut's own current
 * binding is excluded.
 */
export function conflictsFor(
  id: string,
  candidate: Accelerator,
  resolved: readonly ResolvedShortcut[],
): ShortcutConflict[] {
  const self = resolved.find((r) => r.id === id);
  if (!self) return [];
  const out: ShortcutConflict[] = [];
  for (const other of resolved) {
    if (other.id === id || !other.accelerator) continue;
    if (!acceleratorsEqual(candidate, other.accelerator)) continue;
    const kind = shortcutRelation(self, other);
    if (kind) out.push({ ids: [id, other.id], accelerator: serializeAccelerator(candidate), kind });
  }
  return out;
}

export const hasBlockingConflict = (conflicts: readonly ShortcutConflict[]): boolean =>
  conflicts.some((c) => c.kind === "duplicate");
