import { type KeyEventLike, acceleratorFromEvent, acceleratorsEqual } from "./accelerator";
import type { ResolvedShortcut, ShortcutScope } from "./registry";

/**
 * KeyboardEvent → shortcut matching (ENGINEERING_SPEC §6.9). Pure apart from
 * the DOM checks on the event target.
 */

/** Attribute that marks a focus region's scope: `<div data-shortcut-scope="timeline">`. */
export const SCOPE_ATTRIBUTE = "data-shortcut-scope";

const SCOPES: readonly ShortcutScope[] = ["global", "editor", "timeline", "canvas"];
const isScope = (v: string | null): v is ShortcutScope =>
  v !== null && (SCOPES as readonly string[]).includes(v);

/** Spread onto a focus region's root element. */
export function shortcutScopeProps(scope: Exclude<ShortcutScope, "global">): {
  [SCOPE_ATTRIBUTE]: string;
} {
  return { [SCOPE_ATTRIBUTE]: scope };
}

/** True when the event target is a text-entry / slider control that owns keys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    // Buttons-like inputs don't consume typing.
    return !["button", "checkbox", "radio", "submit", "reset", "color", "file", "image"].includes(
      type,
    );
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target.closest(
      '[contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"], [role="spinbutton"]',
    ) !== null
  );
}

/**
 * Scope chain for a focused element, most specific first, always ending in
 * `root` then `global`: focus inside `[data-shortcut-scope=timeline]` within
 * the editor → `["timeline", "editor", "global"]`.
 */
export function scopeChainFor(
  target: EventTarget | null,
  root: ShortcutScope = "editor",
): ShortcutScope[] {
  const chain: ShortcutScope[] = [];
  if (typeof Element !== "undefined" && target instanceof Element) {
    let el: Element | null = target.closest(`[${SCOPE_ATTRIBUTE}]`);
    while (el) {
      const scope = el.getAttribute(SCOPE_ATTRIBUTE);
      if (isScope(scope) && !chain.includes(scope)) chain.push(scope);
      el = el.parentElement?.closest(`[${SCOPE_ATTRIBUTE}]`) ?? null;
    }
  }
  if (!chain.includes(root)) chain.push(root);
  if (!chain.includes("global")) chain.push("global");
  return chain;
}

export interface KeydownLike extends KeyEventLike {
  target: EventTarget | null;
  repeat: boolean;
}

/**
 * Candidates for a keydown, ordered by scope specificity (then registry
 * order). Editable targets yield only `allowInInputs` shortcuts.
 */
export function matchKeydown(
  e: KeydownLike,
  resolved: readonly ResolvedShortcut[],
  chain: readonly ShortcutScope[],
): ResolvedShortcut[] {
  const accel = acceleratorFromEvent(e);
  if (!accel) return [];
  const editable = isEditableTarget(e.target);
  const out: ResolvedShortcut[] = [];
  for (const scope of chain) {
    for (const r of resolved) {
      if (r.scope !== scope || !r.accelerator) continue;
      if (!acceleratorsEqual(r.accelerator, accel)) continue;
      if (editable && !r.def.allowInInputs) continue;
      out.push(r);
    }
  }
  return out;
}
