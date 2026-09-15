import { useEffect } from "react";

/**
 * Typed mirror of the Organic tokens in `tokens.css`. React components should
 * prefer the CSS custom properties; this module exists for contexts that can't
 * read CSS variables — chiefly PixiJS, which needs concrete numeric colors —
 * and owns the runtime theme switch (`data-theme` on <html>).
 */

export const colors = {
  bg: "#f5ead8",
  surface: "#ebddc5",
  text: "#201e1d",
  accent: "#c67139",
  accent2: "#7a8a5e",
  neutral: {
    100: "#f9f4ed",
    200: "#eee7db",
    300: "#dcd3c4",
    400: "#c0b6a5",
    500: "#a19786",
    600: "#82796a",
    700: "#645c50",
    800: "#474238",
    900: "#2e2b25",
  },
  accentRamp: {
    100: "#fff2eb",
    200: "#ffe1d0",
    300: "#ffc6a5",
    400: "#f6a06b",
    500: "#d67f48",
    600: "#b2622d",
    700: "#8c491a",
    800: "#643312",
    900: "#402310",
  },
} as const;

/** Convert a "#rrggbb" string to the 0xRRGGBB number PixiJS expects. */
export function hexToPixi(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}

export const fonts = {
  heading: '"Caprasimo", system-ui, sans-serif',
  body: '"Figtree", system-ui, sans-serif',
} as const;

export const radius = { xs: 6, sm: 8, md: 16, lg: 28, full: 999 } as const;

// ---------------------------------------------------------------------------
// Theme selection
// ---------------------------------------------------------------------------

/** User setting (Settings → General → Theme). "system" follows the OS. */
export type ThemePreference = "system" | "light" | "dark";

/** The palette actually on screen. */
export type ResolvedTheme = "light" | "dark";

export const THEME_ATTRIBUTE = "data-theme";

/**
 * Apply a preference to the document root. "light"/"dark" pin the theme via
 * `data-theme`; "system" removes the attribute so tokens.css falls back to
 * `prefers-color-scheme`.
 */
export function applyThemePreference(
  pref: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (pref === "light" || pref === "dark") root.setAttribute(THEME_ATTRIBUTE, pref);
  else root.removeAttribute(THEME_ATTRIBUTE);
}

/** Which palette a preference renders, given the OS preference. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/**
 * Keep `data-theme` on <html> in sync with the preference. On unmount (or
 * before re-applying) the attribute is restored to what it was before.
 */
export function useThemePreference(
  pref: ThemePreference,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  useEffect(() => {
    if (!root) return;
    const previous = root.getAttribute(THEME_ATTRIBUTE);
    applyThemePreference(pref, root);
    return () => {
      if (previous === null) root.removeAttribute(THEME_ATTRIBUTE);
      else root.setAttribute(THEME_ATTRIBUTE, previous);
    };
  }, [pref, root]);
}
