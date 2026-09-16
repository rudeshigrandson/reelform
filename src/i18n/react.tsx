import { type ReactNode, createContext, useContext, useEffect, useMemo } from "react";
import {
  DEFAULT_LANGUAGE,
  type LanguageSetting,
  type Translate,
  createTranslator,
  resolveLanguage,
  setActiveLanguage,
} from "./format";

interface I18nValue {
  /** Resolved bundled locale tag (e.g. "en"). */
  language: string;
  t: Translate;
}

const I18nContext = createContext<I18nValue>({
  language: DEFAULT_LANGUAGE,
  t: createTranslator(DEFAULT_LANGUAGE),
});

/** The OS/browser language preferences, most preferred first. */
export function navigatorLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

/**
 * Provides `useT()` for a window. `language` is the `language` setting:
 * "system" follows `navigator.languages`; unknown tags fall back to English.
 */
export function I18nProvider({
  language,
  children,
}: {
  language: LanguageSetting;
  children?: ReactNode;
}) {
  const resolved = resolveLanguage(language, navigatorLanguages());
  const value = useMemo(() => ({ language: resolved, t: createTranslator(resolved) }), [resolved]);
  // Keep the non-React `t()` in step with the window's language.
  useEffect(() => setActiveLanguage(resolved), [resolved]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translator for the nearest provider (English without one). */
export function useT(): Translate {
  return useContext(I18nContext).t;
}

/** Resolved locale tag of the nearest provider. */
export function useLanguage(): string {
  return useContext(I18nContext).language;
}
