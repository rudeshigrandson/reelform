import {
  type LanguageSetting,
  type MessageKey,
  type MessageVars,
  createTranslator,
  resolveLanguage,
} from "../src/i18n/format";

/**
 * Main-process strings (tray, native dialogs, notifications) from the same
 * `src/i18n/locales/*.json` catalogs the renderer uses. Pure: the caller
 * passes the `language` setting and the OS locales (`app.getPreferredSystemLanguages()`
 * or `[app.getLocale()]`), so this file never imports `electron`.
 */

/** Keys reserved for the main process. */
export type MainMessageKey = Extract<MessageKey, `main.${string}`>;
export type MainTranslate = (key: MainMessageKey, vars?: MessageVars) => string;

export interface MainTranslator {
  /** Resolved bundled locale tag. */
  language: string;
  t: MainTranslate;
}

export function createMainTranslator(
  setting: LanguageSetting | null | undefined,
  systemLanguages: readonly string[],
): MainTranslator {
  const language = resolveLanguage(setting, systemLanguages);
  const translate = createTranslator(language);
  return { language, t: (key, vars) => translate(key, vars) };
}
