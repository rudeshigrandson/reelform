import en from "./locales/en.json";

/**
 * Minimal typed i18n (ENGINEERING_SPEC §1 `src/i18n`, §14.4 "strings
 * externalized"). Pure and DOM-free so the main process can share it
 * (`electron/i18n.ts`). Message syntax is an ICU subset:
 *
 *   "Hello {name}"                                   interpolation
 *   "{count, plural, =0 {None} one {# file} other {# files}}"  plural
 *
 * `#` inside a plural branch is the number, formatted for the locale. Plural
 * categories come from `Intl.PluralRules`; exact `=n` branches win first and
 * `other` is required as the fallback.
 */

export type Messages = typeof en;
export type MessageKey = keyof Messages;
export type MessageVars = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, vars?: MessageVars) => string;

export const DEFAULT_LANGUAGE = "en";

/** Bundled catalogs. A new language adds `locales/<tag>.json` here. */
export const LOCALES: Readonly<Record<string, Partial<Record<MessageKey, string>>>> = { en };

/** User-facing language setting: "system", "en", or any BCP 47 tag. */
export type LanguageSetting = "system" | "en" | (string & {});

/**
 * Setting → a bundled locale tag. "system" tries each preferred OS/browser
 * language; each candidate matches exactly, then by base language
 * ("en-GB" → "en"); anything unknown falls back to English.
 */
export function resolveLanguage(
  setting: LanguageSetting | null | undefined,
  preferred: readonly string[] = [],
  available: Readonly<Record<string, unknown>> = LOCALES,
): string {
  const candidates = !setting || setting === "system" ? preferred : [setting];
  const tags = Object.keys(available);
  for (const raw of candidates) {
    const want = raw.trim().replace(/_/g, "-").toLowerCase();
    if (!want) continue;
    const exact = tags.find((t) => t.toLowerCase() === want);
    if (exact) return exact;
    const base = want.split("-")[0];
    const partial = tags.find((t) => t.toLowerCase() === base);
    if (partial) return partial;
  }
  return DEFAULT_LANGUAGE;
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function formatNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

function pluralCategory(n: number, locale: string): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(n);
  } catch {
    return n === 1 ? "one" : "other";
  }
}

/** Parse `=0 {…} one {…} other {…}` into branch → body. */
function parseBranches(spec: string): Map<string, string> | null {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < spec.length) {
    while (i < spec.length && /\s/.test(spec[i] as string)) i++;
    if (i >= spec.length) break;
    const selectorStart = i;
    while (i < spec.length && !/[\s{]/.test(spec[i] as string)) i++;
    const selector = spec.slice(selectorStart, i);
    while (i < spec.length && /\s/.test(spec[i] as string)) i++;
    if (!selector || spec[i] !== "{") return null;
    const close = matchingBrace(spec, i);
    if (close < 0) return null;
    branches.set(selector, spec.slice(i + 1, close));
    i = close + 1;
  }
  return branches.has("other") ? branches : null;
}

function formatPlural(
  name: string,
  spec: string,
  vars: MessageVars | undefined,
  locale: string,
): string | null {
  const branches = parseBranches(spec);
  if (!branches) return null;
  const raw = vars?.[name];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const body =
    branches.get(`=${n}`) ?? branches.get(pluralCategory(n, locale)) ?? branches.get("other");
  if (body === undefined) return null;
  // `#` belongs to this plural only; nested arguments are formatted recursively.
  return formatMessage(body.replace(/#/g, formatNumber(n, locale)), vars, locale);
}

/**
 * Format one message. Unknown or missing arguments are left visible as
 * `{name}` so a gap is obvious rather than silently blank.
 */
export function formatMessage(message: string, vars?: MessageVars, locale = DEFAULT_LANGUAGE) {
  let out = "";
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf("{", i);
    if (open < 0) {
      out += message.slice(i);
      break;
    }
    out += message.slice(i, open);
    const close = matchingBrace(message, open);
    if (close < 0) {
      out += message.slice(open);
      break;
    }
    const inner = message.slice(open + 1, close);
    const plural = /^\s*([A-Za-z_][\w]*)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural) {
      out +=
        formatPlural(plural[1] as string, plural[2] as string, vars, locale) ??
        message.slice(open, close + 1);
    } else {
      const name = inner.trim();
      const value = vars?.[name];
      out +=
        value === undefined
          ? message.slice(open, close + 1)
          : typeof value === "number"
            ? formatNumber(value, locale)
            : value;
    }
    i = close + 1;
  }
  return out;
}

/** Throws when a message's braces or plural branches are malformed (used by tests). */
export function assertValidMessage(message: string): void {
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf("{", i);
    const stray = message.indexOf("}", i);
    if (open < 0) {
      if (stray >= 0) throw new Error(`unbalanced "}" in: ${message}`);
      return;
    }
    if (stray >= 0 && stray < open) throw new Error(`unbalanced "}" in: ${message}`);
    const close = matchingBrace(message, open);
    if (close < 0) throw new Error(`unbalanced "{" in: ${message}`);
    const inner = message.slice(open + 1, close);
    if (/,\s*plural\s*,/.test(inner)) {
      const spec = inner.slice(inner.search(/,\s*plural\s*,/)).replace(/^,\s*plural\s*,/, "");
      const branches = parseBranches(spec);
      if (!branches) throw new Error(`plural needs valid branches incl. "other" in: ${message}`);
      for (const body of branches.values()) assertValidMessage(body);
    } else if (!/^\s*[A-Za-z_][\w]*\s*$/.test(inner)) {
      throw new Error(`bad argument "{${inner}}" in: ${message}`);
    }
    i = close + 1;
  }
}

/** A translator bound to one locale, falling back to English, then the key. */
export function createTranslator(language: string = DEFAULT_LANGUAGE): Translate {
  const catalog = LOCALES[language] ?? {};
  const locale = LOCALES[language] ? language : DEFAULT_LANGUAGE;
  return (key, vars) => {
    const message = catalog[key] ?? (en as Record<string, string>)[key] ?? key;
    return formatMessage(message, vars, locale);
  };
}

let active: Translate = createTranslator(DEFAULT_LANGUAGE);

/** Sets the locale used by the standalone {@link t} (the window's I18nProvider does this). */
export function setActiveLanguage(language: string): void {
  active = createTranslator(LOCALES[language] ? language : DEFAULT_LANGUAGE);
}

/** Translate outside React (e.g. in plain helpers), using the active window language. */
export const t: Translate = (key, vars) => active(key, vars);
