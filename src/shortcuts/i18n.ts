import {
  type MessageKey,
  type MessageVars,
  type Translate,
  formatMessage,
  t,
} from "../i18n/format";
import { useT } from "../i18n/react";
import {
  SHORTCUT_MESSAGES,
  type ShortcutDefinition,
  type ShortcutGroup,
  type ShortcutMessageKey,
} from "./registry";

/**
 * Shortcut strings (`shortcuts.*`, catalog namespace
 * `src/i18n/locales/en.shortcuts.json`). Lookups go through the window
 * translator (`useT()` / standalone `t`) so they follow the language setting;
 * a key the shared catalog does not carry yet resolves from the namespace
 * file, so the English UI never shows raw keys.
 */

export type ShortcutsTranslate = (key: ShortcutMessageKey, vars?: MessageVars) => string;

export function translateShortcuts(
  translate: Translate,
  key: ShortcutMessageKey,
  vars?: MessageVars,
): string {
  const out = translate(key as MessageKey, vars);
  return out === key ? formatMessage(SHORTCUT_MESSAGES[key], vars) : out;
}

/** Shortcuts translator for the nearest I18nProvider (English without one). */
export function useShortcutsT(): ShortcutsTranslate {
  const translate = useT();
  return (key, vars) => translateShortcuts(translate, key, vars);
}

/** Standalone lookup in the active window language (non-React helpers). */
export const st: ShortcutsTranslate = (key, vars) => translateShortcuts(t, key, vars);

export const SHORTCUT_GROUP_KEYS: Readonly<Record<ShortcutGroup, ShortcutMessageKey>> = {
  Global: "shortcuts.group.global",
  Editor: "shortcuts.group.editor",
  Timeline: "shortcuts.group.timeline",
};

/** Localized label of a shortcut definition. */
export function shortcutLabel(
  def: Pick<ShortcutDefinition, "labelKey">,
  translate: ShortcutsTranslate = st,
): string {
  return translate(def.labelKey);
}

/** Localized name of a Settings/overlay group. */
export function shortcutGroupLabel(
  group: ShortcutGroup,
  translate: ShortcutsTranslate = st,
): string {
  return translate(SHORTCUT_GROUP_KEYS[group]);
}
