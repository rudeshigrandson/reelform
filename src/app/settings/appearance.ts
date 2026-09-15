import { useEffect } from "react";
import { useThemePreference } from "../../design/theme";
import { accentSwatch } from "../../settings/appearance";
import type { SettingsState } from "../../settings/types";

/**
 * Applies the Appearance page to the document root: theme via
 * `useThemePreference`, `data-density` / `data-reduce-motion` attributes (with
 * the rules that make them do something), and the accent swatch as `--accent*`
 * custom-property overrides.
 */

export const DENSITY_ATTRIBUTE = "data-density";
export const REDUCE_MOTION_ATTRIBUTE = "data-reduce-motion";
/** The theme's own accent, captured before overriding (the "Indigo" swatch shows it). */
export const THEME_ACCENT_PROP = "--accent-theme";
const ACCENT_PROPS = [
  "--accent",
  "--accent-hover",
  "--accent-pressed",
  "--accent-soft",
  THEME_ACCENT_PROP,
] as const;

export const APPEARANCE_STYLE_ID = "reelform-appearance-rules";

/**
 * Rules keyed on the attributes above. Compact scales the spacing tokens by
 * 0.75; reduce motion collapses transitions/animations (exports unaffected:
 * they render through the export engine, not CSS).
 */
export const APPEARANCE_CSS = `
:root[${DENSITY_ATTRIBUTE}="compact"] {
  --space-1: 3.3px; --space-2: 6.6px; --space-3: 9.9px; --space-4: 13.2px;
  --space-5: 16.5px; --space-6: 19.8px; --space-8: 26.4px;
}
:root[${REDUCE_MOTION_ATTRIBUTE}="true"] *,
:root[${REDUCE_MOTION_ATTRIBUTE}="true"] *::before,
:root[${REDUCE_MOTION_ATTRIBUTE}="true"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
`;

export type AppearanceSettings = Pick<SettingsState, "accentColor" | "density" | "reduceMotion">;

/** Inject the appearance rules once per document. */
export function ensureAppearanceStyles(doc: Document): void {
  if (doc.getElementById(APPEARANCE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = APPEARANCE_STYLE_ID;
  style.textContent = APPEARANCE_CSS;
  doc.head.append(style);
}

export function applyAppearance(root: HTMLElement, s: AppearanceSettings): void {
  ensureAppearanceStyles(root.ownerDocument);
  root.setAttribute(DENSITY_ATTRIBUTE, s.density);
  if (s.reduceMotion) root.setAttribute(REDUCE_MOTION_ATTRIBUTE, "true");
  else root.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  for (const p of ACCENT_PROPS) root.style.removeProperty(p);
  const color = accentSwatch(s.accentColor).color;
  if (color === null) return;
  // Read the theme's accent with our overrides removed, so the default swatch
  // keeps showing it instead of the chosen override.
  const themeAccent = root.ownerDocument.defaultView
    ?.getComputedStyle(root)
    .getPropertyValue("--accent")
    .trim();
  if (themeAccent) root.style.setProperty(THEME_ACCENT_PROP, themeAccent);
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-hover", `color-mix(in oklch, ${color} 88%, var(--text-1))`);
  root.style.setProperty("--accent-pressed", `color-mix(in oklch, ${color} 80%, var(--bg-app))`);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${color} 16%, transparent)`);
}

export function clearAppearance(root: HTMLElement): void {
  root.removeAttribute(DENSITY_ATTRIBUTE);
  root.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  for (const p of ACCENT_PROPS) root.style.removeProperty(p);
}

export function useAppearance(
  settings: Pick<SettingsState, "theme"> & AppearanceSettings,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  useThemePreference(settings.theme, root);
  const { theme, accentColor, density, reduceMotion } = settings;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `theme` re-captures the theme accent after a theme switch
  useEffect(() => {
    if (!root) return;
    applyAppearance(root, { accentColor, density, reduceMotion });
  }, [root, theme, accentColor, density, reduceMotion]);
  useEffect(() => {
    if (!root) return;
    return () => clearAppearance(root);
  }, [root]);
}
