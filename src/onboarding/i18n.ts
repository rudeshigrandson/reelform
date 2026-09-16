import { useMemo } from "react";
import {
  DEFAULT_LANGUAGE,
  type MessageKey,
  type MessageVars,
  type Translate,
  formatMessage,
  useLanguage,
  useT,
} from "../i18n";
import catalog from "../i18n/locales/en.onboarding.json";

/**
 * Onboarding strings (`onboarding.*`). They live in their own namespace file
 * (`src/i18n/locales/en.onboarding.json`). The shared translator wins when it
 * knows a key (a locale or the merged catalog); otherwise the English
 * namespace message is formatted for the active locale.
 */
export type OnboardingKey = keyof typeof catalog;
export type OnboardingTranslate = (key: OnboardingKey, vars?: MessageVars) => string;

const messages: Readonly<Record<OnboardingKey, string>> = catalog;

export function createOnboardingTranslator(
  base: Translate,
  language: string = DEFAULT_LANGUAGE,
): OnboardingTranslate {
  return (key, vars) => {
    const shared = base(key as MessageKey, vars);
    return shared !== key ? shared : formatMessage(messages[key], vars, language);
  };
}

/** Translator for onboarding keys in the nearest I18nProvider's language. */
export function useOnboardingT(): OnboardingTranslate {
  const base = useT();
  const language = useLanguage();
  return useMemo(() => createOnboardingTranslator(base, language), [base, language]);
}
