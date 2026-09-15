import { useMemo } from "react";
import {
  type MessageKey,
  type MessageVars,
  type Translate,
  formatMessage,
  t,
  useT,
} from "../../i18n";
import inspectorEn from "../../i18n/locales/en.inspector.json";

/**
 * Inspector strings (`inspector.*`, catalog namespace `locales/en.inspector.json`).
 * Lookups go through the window translator (`useT()` / standalone `t`) so they
 * follow the language setting; a key the shared catalog does not carry yet
 * resolves from the namespace file, so the English UI never shows raw keys.
 */

export type InspectorMessageKey = keyof typeof inspectorEn;

const MESSAGES: Readonly<Record<InspectorMessageKey, string>> = inspectorEn;

export function translateInspector(
  translate: Translate,
  key: InspectorMessageKey,
  vars?: MessageVars,
): string {
  const out = translate(key as MessageKey, vars);
  return out === key ? formatMessage(MESSAGES[key], vars) : out;
}

export type InspectorTranslate = (key: InspectorMessageKey, vars?: MessageVars) => string;

/** Inspector translator for the nearest I18nProvider (English without one). */
export function useInspectorT(): InspectorTranslate {
  const translate = useT();
  return useMemo(() => (key, vars) => translateInspector(translate, key, vars), [translate]);
}

/** Standalone lookup in the active window language (non-React helpers). */
export function ti(key: InspectorMessageKey, vars?: MessageVars): string {
  return translateInspector(t, key, vars);
}

/** A key map whose values translate on each read (active window language), for non-React callers. */
export function translatedRecord<K extends string>(
  keys: Readonly<Record<K, InspectorMessageKey>>,
): Readonly<Record<K, string>> {
  const record = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) {
    Object.defineProperty(record, k, { enumerable: true, get: () => ti(keys[k]) });
  }
  return Object.freeze(record);
}

/** "Couldn't … {detail}" with an empty detail collapses to the sentence alone. */
export function withDetail(
  translate: InspectorTranslate,
  key: InspectorMessageKey,
  detail: string,
): string {
  return translate(key, { detail }).trim();
}
