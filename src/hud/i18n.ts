import { useMemo } from "react";
import {
  DEFAULT_LANGUAGE,
  LOCALES,
  type MessageVars,
  createTranslator,
  formatMessage,
  useLanguage,
} from "../i18n";
import hudEn from "../i18n/locales/en.hud.json";

/**
 * HUD strings (`hud.*`). English lives in `src/i18n/locales/en.hud.json`.
 * The shared translator wins whenever a bundled catalog carries the key
 * (translations, or once the namespace is merged into `en.json`); otherwise
 * the English namespace file is formatted for the window's locale.
 */

export type HudMessageKey = keyof typeof hudEn;
export type HudTranslate = (key: HudMessageKey, vars?: MessageVars) => string;

export const HUD_MESSAGES: Readonly<Record<HudMessageKey, string>> = hudEn;

export function createHudTranslator(language: string = DEFAULT_LANGUAGE): HudTranslate {
  const shared = createTranslator(language) as (key: string, vars?: MessageVars) => string;
  const locale = LOCALES[language] ? language : DEFAULT_LANGUAGE;
  return (key, vars) => {
    const out = shared(key, vars);
    return out === key ? formatMessage(HUD_MESSAGES[key], vars, locale) : out;
  };
}

/** HUD translator for the nearest `I18nProvider` (English without one). */
export function useHudT(): HudTranslate {
  const language = useLanguage();
  return useMemo(() => createHudTranslator(language), [language]);
}
