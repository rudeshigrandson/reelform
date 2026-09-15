import {
  DEFAULT_LANGUAGE,
  type MessageKey,
  type MessageVars,
  t as appT,
  formatMessage,
  useLanguage,
  useT,
} from "../i18n";
import launcherEn from "../i18n/locales/en.launcher.json";

/**
 * Launcher strings (`launcher.*`) live in their own namespace catalog,
 * `src/i18n/locales/en.launcher.json`, which `format.ts` merges into the app
 * catalog. For any key a locale lacks, the English namespace catalog is the
 * fallback, mirroring `createTranslator`.
 */

export const LAUNCHER_MESSAGES: Readonly<Record<string, string>> = launcherEn;

export type LauncherKey = keyof typeof launcherEn | MessageKey;
export type LauncherTranslate = (key: LauncherKey, vars?: MessageVars) => string;

type AppTranslate = (key: MessageKey, vars?: MessageVars) => string;

export function bridgeTranslator(translate: AppTranslate, language: string): LauncherTranslate {
  return (key, vars) => {
    const out = translate(key as MessageKey, vars);
    const fallback = LAUNCHER_MESSAGES[key];
    return out === key && fallback !== undefined ? formatMessage(fallback, vars, language) : out;
  };
}

/** Translator for launcher components, bound to the window's language. */
export function useLauncherT(): LauncherTranslate {
  return bridgeTranslator(useT(), useLanguage());
}

/** Translate outside React (plain helpers), using the active window language. */
export const launcherT: LauncherTranslate = bridgeTranslator(appT, DEFAULT_LANGUAGE);
