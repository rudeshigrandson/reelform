import {
  type MessageKey,
  type MessageVars,
  type Translate,
  formatMessage,
  t,
  useT,
} from "../../i18n";
import timelineEn from "../../i18n/locales/en.timeline.json";

/**
 * Timeline strings (`timeline.*`, catalog namespace `locales/en.timeline.json`).
 * Lookups go through the window translator (`useT()` / standalone `t`) so they
 * follow the language setting; a key the shared catalog does not carry yet
 * resolves from the namespace file, so the English UI never shows raw keys.
 */

export type TimelineMessageKey = keyof typeof timelineEn;

const MESSAGES: Readonly<Record<TimelineMessageKey, string>> = timelineEn;

export function translateTimeline(
  translate: Translate,
  key: TimelineMessageKey,
  vars?: MessageVars,
): string {
  const out = translate(key as MessageKey, vars);
  return out === key ? formatMessage(MESSAGES[key], vars) : out;
}

export type TimelineTranslate = (key: TimelineMessageKey, vars?: MessageVars) => string;

/** Timeline translator for the nearest I18nProvider (English without one). */
export function useTimelineT(): TimelineTranslate {
  const translate = useT();
  return (key, vars) => translateTimeline(translate, key, vars);
}

/** Standalone lookup in the active window language (non-React helpers). */
export function tt(key: TimelineMessageKey, vars?: MessageVars): string {
  return translateTimeline(t, key, vars);
}
