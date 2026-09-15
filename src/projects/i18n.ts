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
import catalog from "../i18n/locales/en.projects.json";

/**
 * Project browser strings (`projects.*`). They live in their own namespace file
 * (`src/i18n/locales/en.projects.json`). The shared translator wins when it
 * knows a key (a locale, the merged catalog, or a shared `common.*` key);
 * otherwise the English namespace message is formatted for the active locale.
 */
export type ProjectsKey = keyof typeof catalog | MessageKey;
export type ProjectsTranslate = (key: ProjectsKey, vars?: MessageVars) => string;

const messages: Readonly<Record<string, string>> = catalog;

export function createProjectsTranslator(
  base: Translate,
  language: string = DEFAULT_LANGUAGE,
): ProjectsTranslate {
  return (key, vars) => {
    const shared = base(key as MessageKey, vars);
    const fallback = messages[key];
    return shared === key && fallback !== undefined
      ? formatMessage(fallback, vars, language)
      : shared;
  };
}

/** Translator for project browser keys in the nearest I18nProvider's language. */
export function useProjectsT(): ProjectsTranslate {
  const base = useT();
  const language = useLanguage();
  return useMemo(() => createProjectsTranslator(base, language), [base, language]);
}
